import { randomUUID } from "crypto";
import type { PortfolioBacktestResult, PortfolioForwardTestRecord, PortfolioResearchHypothesis, PortfolioStrategy, PortfolioWalkForwardResult } from "./domain";
import type { PortfolioMarketDataProvider } from "./marketData";
import type { PortfolioRepository } from "./repository";
import { returnsFromBars, riskStatistics } from "./analytics";
import { optimizePortfolio } from "./optimization";
import { mandatePolicy } from "./mandates";

export class PortfolioResearchEngine {
  constructor(private readonly repository: PortfolioRepository, private readonly marketData: PortfolioMarketDataProvider) {}

  async researchStrategy(strategy: PortfolioStrategy, now = new Date()) {
    if (!this.marketData.getHistoricalBars) return { ok: false as const, reason: "historical_data_unavailable" };
    const symbol = strategy.benchmarkSymbol;
    const bars = await this.marketData.getHistoricalBars(symbol, "etf", { outputSize: "compact", now });
    if (bars.length < 30) return { ok: false as const, reason: "insufficient_history" };
    const hypothesis: PortfolioResearchHypothesis = {
      id: `portfolio-hypothesis-${strategy.id}-${now.toISOString()}`,
      strategyId: strategy.id,
      hypothesis: strategy.researchHypothesis,
      symbols: [symbol],
      evidenceWindowStart: bars[0].observedAt,
      evidenceWindowEnd: bars[bars.length - 1].observedAt,
      status: "created",
      evidence: { provider: this.marketData.id, observations: bars.length, fixture: bars.some((bar) => bar.fixture) },
      createdAt: now.toISOString(),
    };
    await this.repository.saveResearchHypothesis(hypothesis);
    const backtest = await this.backtest(strategy, hypothesis, bars, now);
    const walkForward = await this.walkForward(strategy, backtest, bars, now);
    return { ok: true as const, hypothesis, backtest, walkForward };
  }

  async recordForwardObservation(input: { strategy: PortfolioStrategy; portfolioId: string; nav: number; cash: number; now?: Date }) {
    const now = input.now ?? new Date();
    const quote = await this.marketData.getQuote(input.strategy.benchmarkSymbol, "etf", now);
    const record: PortfolioForwardTestRecord = {
      id: `portfolio-forward-${input.strategy.id}-${input.portfolioId}-${now.toISOString()}`,
      strategyId: input.strategy.id,
      portfolioId: input.portfolioId,
      observedAt: now.toISOString(),
      decision: "HOLD",
      symbol: input.strategy.benchmarkSymbol,
      observedPrice: quote.last,
      assumedFillPrice: null,
      quantity: null,
      nav: input.nav,
      cash: input.cash,
      riskState: { riskLevel: input.strategy.riskLevel, mandate: input.strategy.mandate },
      evidence: { provider: quote.source, fixture: quote.fixture, stale: quote.stale },
    };
    await this.repository.saveForwardTest(record);
    return record;
  }

  private async backtest(strategy: PortfolioStrategy, hypothesis: PortfolioResearchHypothesis, bars: Awaited<ReturnType<NonNullable<PortfolioMarketDataProvider["getHistoricalBars"]>>>, now: Date): Promise<PortfolioBacktestResult> {
    const split = Math.max(10, Math.floor(bars.length * 0.7));
    const validation = bars.slice(split);
    const series = returnsFromBars(strategy.benchmarkSymbol, validation);
    const stats = riskStatistics(series.returns);
    const totalReturnPct = validation.length > 1 ? pct((validation.at(-1)!.adjustedClose ?? validation.at(-1)!.close) - (validation[0].adjustedClose ?? validation[0].close), validation[0].adjustedClose ?? validation[0].close) : 0;
    const policy = mandatePolicy(strategy);
    const passed = validation.length >= 10 && totalReturnPct > -policy.maxDrawdownPct && stats.maxDrawdownPct <= policy.maxDrawdownPct;
    const result: PortfolioBacktestResult = {
      id: `portfolio-backtest-${hypothesis.id}`,
      strategyId: strategy.id,
      hypothesisId: hypothesis.id,
      trainStart: bars[0].observedAt,
      trainEnd: bars[split - 1].observedAt,
      validationStart: validation[0].observedAt,
      validationEnd: validation.at(-1)!.observedAt,
      totalReturnPct,
      benchmarkReturnPct: totalReturnPct,
      maxDrawdownPct: stats.maxDrawdownPct,
      volatilityPct: stats.volatility === null ? null : stats.volatility * 100,
      sharpe: stats.sharpe,
      turnoverPct: 0,
      observations: validation.length,
      passed,
      rejectionReason: passed ? null : "validation_or_risk_requirement_failed",
      evidence: { noFutureLeakage: true, timeOrdered: true, provider: this.marketData.id },
      createdAt: now.toISOString(),
    };
    await this.repository.saveBacktest(result);
    return result;
  }

  private async walkForward(strategy: PortfolioStrategy, backtest: PortfolioBacktestResult, bars: Awaited<ReturnType<NonNullable<PortfolioMarketDataProvider["getHistoricalBars"]>>>, now: Date): Promise<PortfolioWalkForwardResult> {
    const windows = [];
    const windowSize = Math.max(10, Math.floor(bars.length / 4));
    for (let start = 0; start + windowSize * 2 <= bars.length; start += windowSize) {
      const validate = bars.slice(start + windowSize, start + windowSize * 2);
      const series = returnsFromBars(strategy.benchmarkSymbol, validate);
      const stats = riskStatistics(series.returns);
      const returnPct = validate.length > 1 ? pct((validate.at(-1)!.adjustedClose ?? validate.at(-1)!.close) - (validate[0].adjustedClose ?? validate[0].close), validate[0].adjustedClose ?? validate[0].close) : 0;
      windows.push({ trainStart: bars[start].observedAt, trainEnd: bars[start + windowSize - 1].observedAt, validateStart: validate[0].observedAt, validateEnd: validate.at(-1)!.observedAt, returnPct, maxDrawdownPct: stats.maxDrawdownPct });
    }
    const positive = windows.filter((window) => window.returnPct >= 0).length;
    const stabilityScore = windows.length ? Number((positive / windows.length).toFixed(6)) : 0;
    const passed = windows.length >= 2 && stabilityScore >= 0.5 && backtest.passed;
    const result: PortfolioWalkForwardResult = { id: `portfolio-walk-forward-${backtest.id}`, strategyId: strategy.id, backtestId: backtest.id, windows, stabilityScore, passed, rejectionReason: passed ? null : "walk_forward_stability_failed", createdAt: now.toISOString() };
    await this.repository.saveWalkForward(result);
    return result;
  }
}

export function researchAllocation(strategies: PortfolioStrategy[], maxPerCycle: number) {
  const sorted = [...strategies].sort((a, b) => a.riskLevel - b.riskLevel);
  const highQuota = maxPerCycle >= 3 ? 1 : 0;
  const lowRisk = sorted.filter((item) => item.riskLevel <= 4).slice(0, Math.max(1, Math.floor(maxPerCycle * 0.35)));
  const highRisk = sorted.filter((item) => item.riskLevel > 7).slice(0, highQuota);
  const midRisk = sorted.filter((item) => item.riskLevel > 4 && item.riskLevel <= 7).slice(0, Math.max(0, maxPerCycle - lowRisk.length - highRisk.length));
  const selected = [...lowRisk, ...midRisk, ...highRisk];
  for (const strategy of sorted) {
    if (selected.length >= maxPerCycle) break;
    if (!selected.some((item) => item.id === strategy.id)) selected.push(strategy);
  }
  return selected.slice(0, maxPerCycle);
}

export async function optimizeFromProvider(strategy: PortfolioStrategy, provider: PortfolioMarketDataProvider) {
  if (!provider.getHistoricalBars) throw new Error("historical_data_unavailable");
  const bars = await provider.getHistoricalBars(strategy.benchmarkSymbol, "etf");
  return optimizePortfolio({ series: [returnsFromBars(strategy.benchmarkSymbol, bars)], objective: String(strategy.parameters.optimizer ?? "balanced") as never, maxWeight: 1 });
}

function pct(value: number, base: number) {
  return base ? Number((value / base * 100).toFixed(6)) : 0;
}
