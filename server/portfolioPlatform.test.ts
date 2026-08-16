import assert from "node:assert/strict";
import { FixturePortfolioMarketDataProvider, NoPortfolioMarketDataProvider } from "./portfolio/marketData";
import { InMemoryPortfolioRepository } from "./portfolio/repository";
import { PortfolioPlatformService } from "./portfolio/service";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const enabledConfig = {
  enabled: true,
  researchEnabled: false,
  autostart: false,
  liveExecutionEnabled: false,
  startingCapital: 1_000,
  maxActiveStrategies: 20,
  marketDataProvider: "fixture" as const,
  providerCallBudget: 250,
  rebalanceThresholdPct: 1,
};

const repository = new InMemoryPortfolioRepository();
const service = new PortfolioPlatformService(enabledConfig, repository, new FixturePortfolioMarketDataProvider());
const start = new Date("2026-08-14T20:00:00.000Z");
await service.initialize(start);

const strategies = await repository.listStrategies();
const portfolios = await repository.listPortfolios();
assert.equal(strategies.length, 20);
assert.equal(portfolios.length, 20);
assert.equal(new Set(portfolios.map((item) => item.id)).size, 20);
assert.ok(portfolios.every((item) => item.startingCapital === 1_000));
assert.ok(portfolios.every((item) => item.cash === 1_000));

const summaries = await service.summaries(start);
assert.equal(summaries.length, 20);
assert.ok(summaries.every((item) => item.rank !== null));
assert.ok(summaries.every((item) => item.providerSource === "portfolio-fixture-market-data"));

const firstPortfolio = portfolios[0];
const rebalance = await service.rebalance(firstPortfolio.id, new Date("2026-08-14T20:30:00.000Z"));
assert.equal(rebalance.ok, true);
assert.notEqual(rebalance.action, "HOLD");
const afterRebalance = await repository.getPortfolio(firstPortfolio.id);
assert.ok(afterRebalance);
assert.ok(afterRebalance.cash < firstPortfolio.cash);
const positions = await repository.listPositions(firstPortfolio.id);
assert.equal(positions.length, 1);
assert.ok(positions[0].quantity > 0);

const weekendSummary = (await service.summaries(new Date("2026-08-15T12:00:00.000Z"))).find((item) => item.portfolioId === firstPortfolio.id);
assert.ok(weekendSummary);
assert.equal(weekendSummary.dailyPnl, 0);
assert.equal(weekendSummary.dailyPct, 0);

const detail = await service.detail(firstPortfolio.id, new Date("2026-08-17T13:30:00.000Z"));
assert.ok(detail);
assert.equal(detail.positions.length, 1);
assert.ok(detail.decisions.some((event) => event.eventType === "BUY" || event.eventType === "SELL"));
assert.equal(detail.benchmark.available, true);

const unavailable = new PortfolioPlatformService(enabledConfig, new InMemoryPortfolioRepository(), new NoPortfolioMarketDataProvider());
await unavailable.initialize(start);
const unavailableSummaries = await unavailable.summaries(start);
assert.equal(unavailableSummaries.length, 20);
assert.ok(unavailableSummaries.every((item) => item.stale === false || item.marketValue === 0));
const blockedRebalance = await unavailable.rebalance("portfolio-capsafe", start);
assert.equal(blockedRebalance.ok, false);
assert.equal(blockedRebalance.reason, "market_data_unavailable");
const health = await unavailable.health(start);
assert.equal(health.runtimeState, "degraded");
assert.ok(health.blockers.some((item) => item.code === "portfolio_market_data_unavailable"));

const restartedAtCapacity = new PortfolioPlatformService(enabledConfig, repository, new FixturePortfolioMarketDataProvider());
await restartedAtCapacity.initialize(new Date("2026-08-14T21:00:00.000Z"));
const restartedHealth = await restartedAtCapacity.health(new Date("2026-08-14T21:00:00.000Z"));
assert.equal(restartedHealth.runtimeState, "healthy");
assert.equal((await repository.listStrategies()).length, 20);

const overCapacityRepository = new InMemoryPortfolioRepository();
for (const strategy of strategies) await overCapacityRepository.saveStrategy(strategy);
await overCapacityRepository.saveStrategy({
  ...strategies[0],
  id: "portfolio-strategy-over-capacity",
  shortName: "OVERCAP",
});
const overCapacity = new PortfolioPlatformService(enabledConfig, overCapacityRepository, new FixturePortfolioMarketDataProvider());
await overCapacity.initialize(start);
const overCapacityHealth = await overCapacity.health(start);
assert.equal(overCapacityHealth.runtimeState, "degraded");
assert.ok(overCapacityHealth.blockers.some((item) => item.code === "portfolio_max_active_strategies_reached"));

assert.throws(() => new PortfolioPlatformService({
  ...enabledConfig,
  liveExecutionEnabled: true as never,
}), /FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED|liveExecutionEnabled/);
