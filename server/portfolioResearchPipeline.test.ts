import assert from "node:assert/strict";
import { FixturePortfolioMarketDataProvider } from "./portfolio/marketData";
import { InMemoryPortfolioRepository } from "./portfolio/repository";
import { instantiateSeedStrategies } from "./portfolio/strategies";
import { PortfolioResearchEngine, researchAllocation } from "./portfolio/research";
import { PortfolioPlatformService } from "./portfolio/service";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const now = new Date("2026-08-14T15:00:00.000Z");
const repository = new InMemoryPortfolioRepository();
const strategies = instantiateSeedStrategies(100_000, now);
for (const strategy of strategies) await repository.saveStrategy(strategy);
const provider = new FixturePortfolioMarketDataProvider();
const engine = new PortfolioResearchEngine(repository, provider);
const result = await engine.researchStrategy(strategies[0], now);
assert.equal(result.ok, true);
assert.equal((await repository.listResearchHypotheses(strategies[0].id)).length, 1);
assert.equal((await repository.listBacktests(strategies[0].id)).length, 1);
assert.equal((await repository.listWalkForward(strategies[0].id)).length, 1);
assert.equal(result.backtest.evidence.noFutureLeakage, true);
assert.ok(result.walkForward.windows.length >= 2);

const allocation = researchAllocation(strategies, 6);
assert.equal(allocation.length, 6);
assert.ok(allocation.some((strategy) => strategy.riskLevel <= 4));
assert.ok(allocation.some((strategy) => strategy.riskLevel > 7));

const enabledConfig = {
  enabled: true,
  researchEnabled: true,
  autostart: false,
  liveExecutionEnabled: false,
  startingCapital: 100_000,
  maxActiveStrategies: 20,
  marketDataProvider: "fixture" as const,
  alphaVantageApiKey: null,
  providerTimeoutMs: 1_000,
  providerCacheTtlMs: 1_000,
  quoteFreshnessMaxMinutes: 1440,
  fixtureAllowedInProduction: true,
  providerCallBudget: 10,
  rebalanceThresholdPct: 5,
};
const service = new PortfolioPlatformService(enabledConfig, new InMemoryPortfolioRepository(), provider);
await service.initialize(now);
const serviceResearch = await service.research(3, now);
assert.equal(serviceResearch.ok, true);
const artifacts = await service.researchArtifacts(undefined, 20);
assert.ok(artifacts.hypotheses.length >= 3);
assert.ok(artifacts.backtests.every((backtest) => backtest.observations >= 10));

const disabled = new PortfolioPlatformService({ ...enabledConfig, researchEnabled: false }, new InMemoryPortfolioRepository(), provider);
await disabled.initialize(now);
const disabledResearch = await disabled.research(1, now);
assert.equal(disabledResearch.ok, false);
assert.equal(disabledResearch.reason, "portfolio_research_disabled");
