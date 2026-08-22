import assert from "node:assert/strict";
import { InMemoryPortfolioRepository } from "./portfolio/repository";
import { FixturePortfolioMarketDataProvider, type PortfolioMarketDataProvider } from "./portfolio/marketData";
import { VirtualPortfolioBroker } from "./portfolio/broker";
import { accountingSnapshot } from "./portfolio/accounting";
import { canonicalInstrument, optionInstrument } from "./portfolio/instruments";
import { latestLegitimateClose, marketStatusForInstrument } from "./portfolio/calendars";

const repository = new InMemoryPortfolioRepository();
const now = new Date("2026-08-14T15:00:00.000Z");
class DeterministicRealProvider extends FixturePortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "deterministic-real-provider";
  capabilities() {
    return { ...super.capabilities(), fixture: false, live: true };
  }
  async getQuote(symbol: string, assetClass: Parameters<FixturePortfolioMarketDataProvider["getQuote"]>[1], at = new Date()) {
    const quote = await super.getQuote(symbol, assetClass, at);
    return { ...quote, source: this.id, fixture: false };
  }
  async getHistoricalBars(symbol: string, assetClass: Parameters<FixturePortfolioMarketDataProvider["getHistoricalBars"]>[1], input: Parameters<FixturePortfolioMarketDataProvider["getHistoricalBars"]>[2] = {}) {
    const bars = await super.getHistoricalBars(symbol, assetClass, input);
    return bars.map((bar) => ({ ...bar, source: this.id, fixture: false }));
  }
}
await repository.saveStrategy({
  id: "strategy-test",
  shortName: "TEST",
  name: "Test",
  description: "Test strategy",
  mandate: "balanced",
  riskLevel: 5,
  riskLabel: "Moderate",
  lifecycleState: "VIRTUAL_LIVE_DATA",
  strategyVersion: 1,
  parentStrategyId: null,
  researchHypothesis: "Test",
  parameters: {},
  benchmarkSymbol: "SPY",
  startingCapital: 10_000,
  currency: "USD",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
await repository.savePortfolio({ id: "portfolio-test", strategyId: "strategy-test", startingCapital: 10_000, cash: 10_000, currency: "USD", status: "active", createdAt: now.toISOString(), updatedAt: now.toISOString() });

const fixtureBlocked = await new VirtualPortfolioBroker(repository, new FixturePortfolioMarketDataProvider(), { conservativeSpreadBps: 20, slippageBps: 2, minFee: 1, feeBps: 5 }).submitOrder({ portfolioId: "portfolio-test", idempotencyKey: "fixture-1", side: "BUY", symbol: "SPY", assetClass: "etf", quantity: 1, reason: "fixture blocked", now });
assert.equal(fixtureBlocked.ok, false);
assert.equal(fixtureBlocked.reason, "real_market_data_required");

const broker = new VirtualPortfolioBroker(repository, new DeterministicRealProvider(), { conservativeSpreadBps: 20, slippageBps: 2, minFee: 1, feeBps: 5 });
const buy = await broker.submitOrder({ portfolioId: "portfolio-test", idempotencyKey: "buy-1", side: "BUY", symbol: "SPY", assetClass: "etf", quantity: 10, reason: "test buy", now });
assert.equal(buy.ok, true);
assert.equal((await repository.listOrders("portfolio-test")).length, 2);
assert.equal((await repository.listTransactions("portfolio-test")).length, 1);
const afterBuy = await repository.getPortfolio("portfolio-test");
assert.ok(afterBuy);
assert.ok(afterBuy.cash < 10_000);
assert.equal((await repository.listPositions("portfolio-test"))[0].quantity, 10);

const duplicate = await broker.submitOrder({ portfolioId: "portfolio-test", idempotencyKey: "buy-1", side: "BUY", symbol: "SPY", assetClass: "etf", quantity: 10, reason: "test buy", now });
assert.equal(duplicate.ok, true);
assert.equal(duplicate.idempotent, true);
assert.equal((await repository.listTransactions("portfolio-test")).length, 1);

const closed = await broker.submitOrder({ portfolioId: "portfolio-test", idempotencyKey: "buy-weekend", side: "BUY", symbol: "SPY", assetClass: "etf", quantity: 1, reason: "weekend", now: new Date("2026-08-15T15:00:00.000Z") });
assert.equal(closed.ok, false);
assert.equal(closed.reason, "market_closed");

const sellTooMuch = await broker.submitOrder({ portfolioId: "portfolio-test", idempotencyKey: "sell-too-much", side: "SELL", symbol: "SPY", assetClass: "etf", quantity: 20, reason: "sell", now });
assert.equal(sellTooMuch.ok, false);
assert.equal(sellTooMuch.reason, "portfolio_position_insufficient_quantity");

const portfolio = await repository.getPortfolio("portfolio-test");
assert.ok(portfolio);
const positions = await repository.listPositions("portfolio-test");
const transactions = await repository.listTransactions("portfolio-test");
const snapshot = accountingSnapshot({ portfolio, positions: positions.map((position) => ({ ...position, currentPrice: 545.39 })), transactions, now });
assert.ok(snapshot.nav > 0);
assert.ok(snapshot.fees > 2.7 && snapshot.fees < 2.8);
assert.equal(snapshot.dailyPct, snapshot.allTimePct);
const weekendSnapshot = accountingSnapshot({ portfolio, positions: positions.map((position) => ({ ...position, currentPrice: 545.39 })), transactions, now: new Date("2026-08-15T12:00:00.000Z") });
assert.equal(weekendSnapshot.dailyPnl, 0);

const spy = canonicalInstrument("SPY", { assetClass: "etf", displayName: "SPDR S&P 500 ETF Trust" });
assert.equal(spy.marketCalendar, "US_EQUITY");
assert.equal(marketStatusForInstrument(spy, now).status, "open");
assert.equal(marketStatusForInstrument(spy, new Date("2026-08-15T15:00:00.000Z")).status, "closed");
assert.equal(latestLegitimateClose(new Date("2026-08-15T15:00:00.000Z")).toISOString(), "2026-08-14T21:00:00.000Z");

const option = optionInstrument({ symbol: "SPY260918C00550000", underlying: "SPY", strike: 550, expiration: "2026-09-18", optionType: "call" });
assert.equal(option.assetClass, "option");
assert.equal(option.contractMultiplier, 100);
assert.equal(option.benchmarkEligible, false);
