import assert from "node:assert/strict";
import { InMemoryPortfolioRepository } from "./portfolio/repository";
import { FixturePortfolioMarketDataProvider } from "./portfolio/marketData";
import { PortfolioPlatformService } from "./portfolio/service";
import { PortfolioResearchEngine } from "./portfolio/research";
import { lifecycleDecision, lifecycleEvent, mutateStrategy } from "./portfolio/lifecycle";
import { PortfolioNotificationService } from "./portfolio/notifications";
import { portfolioReadiness } from "./portfolio/readiness";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const config = {
  enabled: true,
  researchEnabled: true,
  autostart: false,
  liveExecutionEnabled: false,
  startingCapital: 100_000,
  maxActiveStrategies: 40,
  marketDataProvider: "fixture" as const,
  alphaVantageApiKey: null,
  providerTimeoutMs: 1_000,
  providerCacheTtlMs: 60_000,
  quoteFreshnessMaxMinutes: 1440,
  fixtureAllowedInProduction: true,
  providerCallBudget: 500,
  rebalanceThresholdPct: 1,
};
const now = new Date("2026-08-14T15:00:00.000Z");
const repository = new InMemoryPortfolioRepository();
class DeterministicRealProvider extends FixturePortfolioMarketDataProvider {
  id = "deterministic-real-provider";
  capabilities() { return { ...super.capabilities(), fixture: false, live: true }; }
  async getQuote(symbol: string, assetClass: Parameters<FixturePortfolioMarketDataProvider["getQuote"]>[1], at = new Date()) {
    const quote = await super.getQuote(symbol, assetClass, at);
    return { ...quote, source: this.id, fixture: false };
  }
  async getHistoricalBars(symbol: string, assetClass: Parameters<FixturePortfolioMarketDataProvider["getHistoricalBars"]>[1], input: Parameters<FixturePortfolioMarketDataProvider["getHistoricalBars"]>[2] = {}) {
    const bars = await super.getHistoricalBars(symbol, assetClass, input);
    return bars.map((bar) => ({ ...bar, source: this.id, fixture: false }));
  }
}
const provider = new DeterministicRealProvider();
const service = new PortfolioPlatformService(config, repository, provider);
await service.initialize(now);

const initialSummaries = await service.summaries(now);
assert.equal(initialSummaries.length, 20);
const research = await service.research(5, now);
assert.equal(research.ok, true);
assert.ok((await repository.listResearchHypotheses()).length >= 5);
assert.ok((await repository.listBacktests()).length >= 5);
assert.ok((await repository.listWalkForward()).length >= 5);

const portfolio = (await repository.listPortfolios())[0];
const strategy = (await repository.getStrategy(portfolio.strategyId))!;
const rebalance = await service.rebalance(portfolio.id, now);
assert.equal(rebalance.ok, true);
assert.ok((await repository.listOrders(portfolio.id)).length >= 1);
assert.ok((await repository.listTransactions(portfolio.id)).length >= 1);

const afterSummary = (await service.summaries(now)).find((item) => item.portfolioId === portfolio.id)!;
const engine = new PortfolioResearchEngine(repository, provider);
const forward = await engine.recordForwardObservation({ strategy, portfolioId: portfolio.id, nav: afterSummary.nav, cash: afterSummary.cash, now });
assert.equal(forward.decision, "HOLD");
assert.equal((await repository.listForwardTests(portfolio.id)).length, 1);

const backtest = (await repository.listBacktests(strategy.id))[0];
const walkForward = (await repository.listWalkForward(strategy.id))[0];
const lifecycle = lifecycleDecision({ strategy, backtestPassed: backtest?.passed ?? false, walkForwardPassed: walkForward?.passed ?? false, forwardDays: 30, drawdownPct: afterSummary.allTimePct < 0 ? Math.abs(afterSummary.allTimePct) : 0, now });
await repository.addDecision(lifecycleEvent({ strategy, stage: lifecycle.stage, reason: lifecycle.reason, now }));
assert.ok((await repository.listDecisions(undefined, 100)).some((event) => event.strategyId === strategy.id));

const child = mutateStrategy(strategy, { suffix: "E2E", now });
await repository.saveStrategy(child);
assert.equal((await repository.getStrategy(child.id))?.parentStrategyId, strategy.id);

const messages: string[] = [];
const notifications = new PortfolioNotificationService({ sendOperations: async (_kind, text) => { messages.push(text); return { sent: true as const }; } }, 1);
await notifications.rebalance({ strategy: strategy.shortName, nav: afterSummary.nav, riskLevel: strategy.riskLevel, reason: "End-to-end rebalance test.", changes: ["Benchmark allocation updated from 0% to target."], expectedVolatilityBefore: null, expectedVolatilityAfter: null });
await notifications.lifecycle({ strategy: strategy.shortName, stage: lifecycle.stage, reason: lifecycle.reason });
assert.ok(messages.some((message) => /Virtual portfolio only/.test(message)));

const recovered = new PortfolioPlatformService(config, repository, provider);
const recoveredSummary = await recovered.detail(portfolio.id, now);
assert.ok(recoveredSummary);
assert.ok(recoveredSummary.decisions.length >= 1);
assert.ok((await repository.listForwardTests(portfolio.id)).length === 1);

const softwareReady = portfolioReadiness({
  config: { ...config, marketDataProvider: "alpha_vantage", alphaVantageApiKey: "SET" },
  provider: {
    ...provider,
    capabilities: () => ({
      ...provider.capabilities(),
      capabilities: [...provider.capabilities().capabilities, "REFERENCE_DATA", "CORPORATE_ACTIONS", "OPTIONS_CHAIN", "OPTION_QUOTES", "INDEX_DATA", "ETF_DATA"],
      assetClasses: [...provider.capabilities().assetClasses, "option"],
      fixture: false,
      live: true,
      options: true,
    }),
  },
  blockers: [],
  env: { FINCOACH_AUTH_REQUIRED: "true", DATABASE_URL: "postgres://local/test" } as NodeJS.ProcessEnv,
});
assert.equal(softwareReady.codeReady, true);
assert.equal(softwareReady.liveExecutionBlocked, true);
const localFixtureReadiness = portfolioReadiness({ config, provider: new FixturePortfolioMarketDataProvider(), blockers: [], env: {} as NodeJS.ProcessEnv });
assert.equal(localFixtureReadiness.activationReady, false);
