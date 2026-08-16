import { loadPortfolioConfig, type PortfolioConfig } from "./config";
import type { AssetClass, PortfolioAccount, PortfolioDecisionEvent, PortfolioDetail, PortfolioHealth, PortfolioPosition, PortfolioSummary, PortfolioStrategy } from "./domain";
import { createPortfolioMarketDataProvider, type PortfolioMarketDataProvider } from "./marketData";
import { createPortfolioRepository, type PortfolioRepository } from "./repository";
import { instantiateSeedStrategies } from "./strategies";
import { OperationalBlockerService } from "../operationalBlockerService";
import { structuredLogger } from "../structuredLogger";
import { VirtualPortfolioBroker } from "./broker";
import { accountingSnapshot } from "./accounting";
import { PortfolioResearchEngine, researchAllocation } from "./research";
import { portfolioReadiness } from "./readiness";

type RankedSummary = PortfolioSummary & { score: number; confidence: number };
export type PortfolioPlatformLike = Pick<PortfolioPlatformService, "summaries" | "health">;

export class PortfolioPlatformService {
  private initialized = false;
  private lastRefresh: string | null = null;
  private lastRebalance: string | null = null;
  private lastResearchCycle: string | null = null;
  private blockers: Array<Record<string, unknown>> = [];

  constructor(
    private readonly config: PortfolioConfig = loadPortfolioConfig(),
    private readonly repository: PortfolioRepository = createPortfolioRepository(),
    private readonly marketData: PortfolioMarketDataProvider = createPortfolioMarketDataProvider(config.marketDataProvider, config),
    private readonly blockerService = new OperationalBlockerService(),
  ) {
    if ((this.config as { liveExecutionEnabled?: boolean }).liveExecutionEnabled === true) {
      throw new Error("FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED must remain false.");
    }
  }

  async initialize(now = new Date()) {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.config.enabled) {
      await this.recordBlocker("portfolio_runtime_disabled", "Portfolio runtime", false, true, "FINCOACH_PORTFOLIO_ENABLED", true);
      return;
    }
    await this.bootstrap(now);
  }

  async bootstrap(now = new Date()) {
    const existing = await this.repository.listStrategies();
    if (existing.length > this.config.maxActiveStrategies) {
      await this.recordBlocker("portfolio_max_active_strategies_reached", "portfolio strategy bootstrap", existing.length, this.config.maxActiveStrategies, "FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES", true);
      return existing;
    }
    if (existing.length === this.config.maxActiveStrategies) return existing;
    const seeds = instantiateSeedStrategies(this.config.startingCapital, now).slice(0, this.config.maxActiveStrategies);
    for (const strategy of seeds) {
      await this.repository.saveStrategy(strategy);
      const portfolio: PortfolioAccount = {
        id: `portfolio-${strategy.shortName.toLowerCase()}`,
        strategyId: strategy.id,
        startingCapital: strategy.startingCapital,
        cash: strategy.startingCapital,
        currency: "USD",
        status: "active",
        createdAt: strategy.createdAt,
        updatedAt: strategy.updatedAt,
      };
      await this.repository.savePortfolio(portfolio);
      await this.repository.addDecision(decision("STRATEGY_CREATED", portfolio.id, strategy.id, null, "Initial portfolio strategy bootstrap", {}, { startingCapital: portfolio.startingCapital, mandate: strategy.mandate }, { researchHypothesis: strategy.researchHypothesis }, now));
    }
    this.lastResearchCycle = now.toISOString();
    return this.repository.listStrategies();
  }

  async summaries(now = new Date()) {
    await this.initialize(now);
    if (!this.config.enabled) return [];
    const strategies = await this.repository.listStrategies();
    const portfolios = await this.repository.listPortfolios();
    const results: RankedSummary[] = [];
    for (const portfolio of portfolios) {
      const strategy = strategies.find((item) => item.id === portfolio.strategyId);
      if (!strategy) continue;
      results.push(await this.summary(strategy, portfolio, now));
    }
    return rank(results).map(({ score: _score, confidence: _confidence, ...summary }) => summary);
  }

  async detail(portfolioId: string, now = new Date()): Promise<PortfolioDetail | null> {
    await this.initialize(now);
    const portfolio = await this.repository.getPortfolio(portfolioId);
    if (!portfolio) return null;
    const strategy = await this.repository.getStrategy(portfolio.strategyId);
    if (!strategy) return null;
    const summary = await this.summary(strategy, portfolio, now);
    const positions = await this.valuedPositions(portfolio, now, summary.nav);
    const decisions = await this.repository.listDecisions(portfolio.id, 100);
    const equityCurve = await this.repository.navHistory(portfolio.id, 120);
    return {
      ...summary,
      positions,
      decisions,
      metrics: metrics(summary, positions),
      equityCurve,
      benchmark: { symbol: strategy.benchmarkSymbol, available: this.marketData.capabilities().latestQuote, reason: this.marketData.capabilities().latestQuote ? undefined : "No production portfolio market-data provider configured." },
      lineage: { parentStrategyId: strategy.parentStrategyId, strategyVersion: strategy.strategyVersion, researchHypothesis: strategy.researchHypothesis, parameters: strategy.parameters },
    };
  }

  async activity(limit = 100) {
    return this.repository.listDecisions(undefined, limit);
  }

  async transactions(portfolioId: string, limit = 100) {
    return this.repository.listTransactions(portfolioId, limit);
  }

  async orders(portfolioId: string, limit = 100) {
    return this.repository.listOrders(portfolioId, limit);
  }

  async rankings(now = new Date()) {
    const { rankLeaderboards } = await import("./analytics");
    return rankLeaderboards(await this.summaries(now));
  }

  async research(limit = 5, now = new Date()) {
    await this.initialize(now);
    if (!this.config.enabled || !this.config.researchEnabled) return { ok: false as const, reason: "portfolio_research_disabled" };
    const strategies = researchAllocation(await this.repository.listStrategies(), limit);
    const engine = new PortfolioResearchEngine(this.repository, this.marketData);
    const results = [];
    for (const strategy of strategies) {
      try {
        results.push(await engine.researchStrategy(strategy, now));
      } catch (error) {
        await this.recordBlocker("portfolio_research_failed", `research ${strategy.shortName}`, error instanceof Error ? error.message : "research failed", "provider-backed historical data", "FINCOACH_PORTFOLIO_RESEARCH_ENABLED", false);
        results.push({ ok: false as const, strategyId: strategy.id, reason: error instanceof Error ? error.message : "research_failed" });
      }
    }
    this.lastResearchCycle = now.toISOString();
    return { ok: true as const, results };
  }

  async researchArtifacts(strategyId?: string, limit = 100) {
    return {
      hypotheses: await this.repository.listResearchHypotheses(strategyId, limit),
      backtests: await this.repository.listBacktests(strategyId, limit),
      walkForward: await this.repository.listWalkForward(strategyId, limit),
      forwardTests: await this.repository.listForwardTests(undefined, limit),
    };
  }

  async rebalance(portfolioId: string, now = new Date()) {
    await this.initialize(now);
    if (!this.config.enabled) return { ok: false as const, reason: "portfolio_disabled" };
    const portfolio = await this.repository.getPortfolio(portfolioId);
    if (!portfolio) return { ok: false as const, reason: "portfolio_not_found" };
    const strategy = await this.repository.getStrategy(portfolio.strategyId);
    if (!strategy) return { ok: false as const, reason: "strategy_not_found" };
    const symbol = primarySymbol(strategy);
    const quote = await this.quote(symbol, "etf", now);
    if (!quote) return { ok: false as const, reason: "market_data_unavailable" };
    const targetCashPct = Math.max(2, 40 - strategy.riskLevel * 3);
    const targetInvest = portfolio.startingCapital * (1 - targetCashPct / 100);
    const currentPositions = await this.repository.listPositions(portfolio.id);
    const current = currentPositions.find((item) => item.symbol === symbol);
    const currentValue = (current?.quantity ?? 0) * quote.last;
    const driftPct = portfolio.startingCapital > 0 ? Math.abs(targetInvest - currentValue) / portfolio.startingCapital * 100 : 0;
    if (driftPct < this.config.rebalanceThresholdPct) {
      await this.repository.addDecision(decision("HOLD", portfolio.id, strategy.id, symbol, "Allocation drift is below rebalance threshold.", { currentValue }, { targetInvest }, { driftPct, thresholdPct: this.config.rebalanceThresholdPct }, now));
      return { ok: true as const, action: "HOLD", driftPct };
    }
    const deltaValue = targetInvest - currentValue;
    const side = deltaValue > 0 ? "BUY" : "SELL";
    const quantity = Math.abs(deltaValue) / (quote.ask ?? quote.last);
    const broker = new VirtualPortfolioBroker(this.repository, this.marketData);
    const fill = await broker.submitOrder({ portfolioId: portfolio.id, idempotencyKey: `rebalance:${portfolio.id}:${strategy.strategyVersion}:${symbol}:${now.toISOString().slice(0, 13)}`, side, symbol, assetClass: "etf", quantity, reason: `Rebalance toward ${strategy.shortName} mandate.`, now });
    if (!fill.ok) {
      await this.recordBlocker(`portfolio_${fill.reason}`, `rebalance ${portfolio.id}`, fill.reason, "filled virtual order", "FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT", false);
      return { ok: false as const, reason: fill.reason };
    }
    await this.repository.addDecision(decision(side === "BUY" ? "BUY" : "SELL", portfolio.id, strategy.id, symbol, `Rebalance toward ${strategy.shortName} mandate.`, { currentValue, cash: portfolio.cash }, { targetInvest, estimatedTradeValue: deltaValue }, { driftPct, quoteSource: quote.source, fixture: quote.fixture, orderId: fill.order.id }, now));
    this.lastRebalance = now.toISOString();
    structuredLogger.audit({ level: "info", event: "portfolio_rebalance_completed", message: "Portfolio virtual rebalance completed", portfolioId, strategyId: strategy.id, liveExecutionBlocked: true });
    return { ok: true as const, action: side, driftPct };
  }

  async health(now = new Date()): Promise<PortfolioHealth> {
    await this.initialize(now);
    const strategies = this.config.enabled ? await this.repository.listStrategies() : [];
    return {
      enabled: this.config.enabled,
      liveExecutionBlocked: true,
      runtimeState: !this.config.enabled ? "disabled" : this.blockers.length ? "degraded" : "healthy",
      activePortfolios: this.config.enabled ? (await this.repository.listPortfolios()).length : 0,
      experimentalStrategies: strategies.filter((item) => item.riskLevel >= 10 || item.lifecycleState === "RESEARCH").length,
      providerHealth: !this.config.enabled ? "disabled" : this.marketData.capabilities().live ? "healthy" : "degraded",
      lastSuccessfulMarketDataRefresh: this.lastRefresh,
      lastRebalance: this.lastRebalance,
      lastResearchCycle: this.lastResearchCycle,
      blockers: this.blockers,
      fallbacks: this.config.marketDataProvider === "fixture" ? [{ code: "portfolio_fixture_market_data", expected: true, action: "Configure a production market-data provider before relying on live valuations." }] : [],
      marketDataAgeSeconds: this.lastRefresh ? Math.max(0, Math.round((now.getTime() - Date.parse(this.lastRefresh)) / 1000)) : null,
      schedulerHealth: this.config.autostart ? "idle" : "disabled",
      readiness: portfolioReadiness({ config: this.config, provider: this.marketData, blockers: this.blockers }),
    };
  }

  private async summary(strategy: PortfolioStrategy, portfolio: PortfolioAccount, now: Date): Promise<RankedSummary> {
    const positions = await this.valuedPositions(portfolio, now, portfolio.startingCapital);
    const transactions = await this.repository.listTransactions(portfolio.id, 500);
    const snapshot = accountingSnapshot({ portfolio, positions, transactions, now });
    const { nav, marketValue, dailyPnl, dailyPct, weeklyPnl, weeklyPct, monthlyPnl, monthlyPct, allTimePnl, allTimePct } = snapshot;
    await this.repository.saveNav({ portfolioId: portfolio.id, nav, cash: portfolio.cash, marketValue, realizedPnl: snapshot.realizedPnl, unrealizedPnl: snapshot.unrealizedPnl, dailyPnl, weeklyPnl, source: this.marketData.id, stale: positions.some((item) => item.stale), observedAt: now.toISOString(), idempotencyKey: `${portfolio.id}:${now.toISOString().slice(0, 13)}` });
    const confidence = confidenceFor(strategy);
    const readinessStatus = portfolioReadiness({ config: this.config, provider: this.marketData, blockers: this.blockers }).status;
    return { portfolioId: portfolio.id, strategyId: strategy.id, shortName: strategy.shortName, name: strategy.name, description: strategy.description, riskLevel: strategy.riskLevel, riskLabel: strategy.riskLabel, mandate: strategy.mandate, lifecycleState: strategy.lifecycleState, rank: null, nav, cash: round(portfolio.cash), marketValue, dailyPnl, dailyPct, weeklyPnl, weeklyPct, monthlyPnl, monthlyPct, allTimePnl, allTimePct, stale: positions.some((item) => item.stale), providerSource: this.marketData.id, benchmarkSymbol: strategy.benchmarkSymbol, readinessStatus, score: allTimePct - strategy.riskLevel * 0.05 + confidence, confidence };
  }

  private async valuedPositions(portfolio: PortfolioAccount, now: Date, nav: number): Promise<PortfolioDetail["positions"]> {
    const positions = await this.repository.listPositions(portfolio.id);
    const valued = [];
    for (const position of positions) {
      const quote = await this.quote(position.symbol, position.assetClass, now);
      const currentPrice = quote?.last ?? null;
      const marketValue = currentPrice ? round(position.quantity * currentPrice) : 0;
      valued.push({ ...position, currentPrice, marketValue, unrealizedPnl: currentPrice ? round((currentPrice - position.averageCost) * position.quantity) : 0, allocationPct: pct(marketValue, nav), stale: quote?.stale ?? true });
    }
    return valued;
  }

  private async quote(symbol: string, assetClass: AssetClass, now: Date) {
    try {
      const quote = await this.marketData.getQuote(symbol, assetClass, now);
      this.lastRefresh = quote.observedAt;
      return quote;
    } catch (error) {
      await this.recordBlocker("portfolio_market_data_unavailable", `market data for ${symbol}`, "unavailable", "observed quote required", "FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER", false);
      structuredLogger.application({ level: "warn", event: "portfolio_market_data_unavailable", message: "Portfolio market data unavailable", symbol, error });
      return null;
    }
  }

  private async recordBlocker(code: string, whatBlocked: string, currentValue: unknown, limitValue: unknown, configKey: string, expected: boolean) {
    const blocker = { code, whatBlocked, currentValue, limitValue, configKey, expected, action: expected ? "Review configuration before enabling this Portfolio capability." : "Configure a supported provider or disable the affected Portfolio workflow." };
    this.blockers = [blocker];
    await this.blockerService.record({
      kind: expected ? "configuration" : "dependency",
      code,
      title: expected ? "Portfolio configuration gate active" : "Portfolio provider degraded",
      whatBlocked,
      reason: code,
      currentValue,
      limitValue,
      configKey,
      configValueState: currentValue === false || currentValue === "unavailable" ? "SET" : "EMPTY",
      scope: { component: "portfolio" },
      expected,
      action: blocker.action,
      effect: "Portfolio subsystem degrades independently from FX/V2.",
      severity: expected ? "warning" : "critical",
    }).catch(() => undefined);
  }
}

export const portfolioPlatformService = new PortfolioPlatformService();

function decision(eventType: string, portfolioId: string | null, strategyId: string | null, symbol: string | null, reason: string, beforeState: Record<string, unknown>, afterState: Record<string, unknown>, evidence: Record<string, unknown>, now: Date): PortfolioDecisionEvent {
  return { id: `${eventType}:${portfolioId ?? "none"}:${strategyId ?? "none"}:${symbol ?? "none"}:${now.toISOString()}`, portfolioId, strategyId, eventType, symbol, reason, beforeState, afterState, evidence, expectedEffect: {}, actualEffect: {}, createdAt: now.toISOString() };
}

function primarySymbol(strategy: PortfolioStrategy) {
  return strategy.benchmarkSymbol === "AOM" ? "AOR" : strategy.benchmarkSymbol;
}

function rank(items: RankedSummary[]) {
  return [...items].sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1 }));
}

function metrics(summary: PortfolioSummary, positions: PortfolioDetail["positions"]) {
  const concentrationPct = Math.max(0, ...positions.map((item) => item.allocationPct));
  return { volatility: null, sharpe: null, sortino: null, maxDrawdownPct: Math.max(0, -summary.allTimePct), var95: null, cvar95: null, concentrationPct, confidence: Math.max(0.1, Math.min(0.95, 0.35 + positions.length * 0.05)) };
}

function confidenceFor(strategy: PortfolioStrategy) {
  return strategy.lifecycleState === "VIRTUAL_LIVE_DATA" ? 0.55 : 0.25;
}

function pct(value: number, base: number) {
  return base ? round(value / base * 100) : 0;
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function isWeekend(now: Date) {
  const day = now.getUTCDay();
  return day === 0 || day === 6;
}
