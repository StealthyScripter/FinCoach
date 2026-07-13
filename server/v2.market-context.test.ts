import assert from "node:assert/strict";
import { MarketContextV2EventTypes, MarketContextV2Service } from "./v2/market-context";
import { MarketDataV2Service } from "./v2/market-data";

const marketData = new MarketDataV2Service();
const contextService = new MarketContextV2Service();

const quote = marketData.normalizeQuote({
  symbol: "EUR_USD",
  bid: 1.1,
  ask: 1.1002,
  provider: "fixture",
  observedAt: "2026-03-09T13:00:00.000Z",
  sourceReceivedAt: "2026-03-09T13:00:00.000Z",
});
const candles = Array.from({ length: 6 }, (_, index) => marketData.normalizeCandle({
  symbol: "EUR_USD",
  timeframe: "1h",
  timestamp: new Date(Date.UTC(2026, 2, 9, 8 + index)).toISOString(),
  open: 1.1 + index * 0.002,
  high: 1.101 + index * 0.002,
  low: 1.0995 + index * 0.002,
  close: 1.1008 + index * 0.002,
  volume: 100 + index,
  provider: "fixture",
}));

const london = contextService.create({
  symbol: "EUR_USD",
  assetClass: "forex",
  observedAt: "2026-03-09T13:00:00.000Z",
  quote,
  candles,
  calendarFreshAsOf: "2026-03-09T12:30:00.000Z",
  higherTimeframeDirection: "up",
  crossAssetContext: { dxy: "down" },
});
assert.equal(london.context.activeSession, "london_new_york_overlap");
assert.equal(london.context.marketOpen, true);
assert.equal(london.context.sessionOverlap, true);
assert.equal(london.context.spreadState, "tight");
assert.equal(london.context.liquidityState, "deep");
assert.equal(london.context.trendRangeRegime, "trend");
assert.ok(london.events.some((event) => event.eventType === MarketContextV2EventTypes.MarketContextCreated));
assert.ok(london.events.some((event) => event.eventType === MarketContextV2EventTypes.MarketSessionOpened));

const stockRegular = contextService.create({
  symbol: "AAPL",
  assetClass: "stock",
  observedAt: "2026-03-09T14:00:00.000Z",
  calendarFreshAsOf: "2026-03-09T13:00:00.000Z",
});
assert.equal(stockRegular.context.activeSession, "new_york");
assert.equal(stockRegular.context.marketOpen, true);

const stockPremarket = contextService.create({
  symbol: "AAPL",
  assetClass: "stock",
  observedAt: "2026-03-09T11:00:00.000Z",
  calendarFreshAsOf: "2026-03-09T10:00:00.000Z",
});
assert.equal(stockPremarket.context.activeSession, "asia");
assert.equal(stockPremarket.context.marketOpen, true);

const stockClosed = contextService.create({
  symbol: "AAPL",
  assetClass: "stock",
  observedAt: "2026-03-09T01:00:00.000Z",
  calendarFreshAsOf: "2026-03-09T00:00:00.000Z",
});
assert.equal(stockClosed.context.marketOpen, false);
assert.ok(stockClosed.events.some((event) => event.eventType === MarketContextV2EventTypes.MarketSessionClosed));

const forexWeekend = contextService.create({
  symbol: "EUR_USD",
  assetClass: "forex",
  observedAt: "2026-03-07T12:00:00.000Z",
});
assert.equal(forexWeekend.context.marketOpen, false);
assert.equal(forexWeekend.context.liquidityState, "closed");

const holiday = contextService.create({
  symbol: "MSFT",
  assetClass: "stock",
  observedAt: "2026-07-04T14:00:00.000Z",
  calendarFreshAsOf: "2026-07-04T13:00:00.000Z",
});
assert.equal(holiday.context.holiday, true);
assert.equal(holiday.context.marketOpen, false);

const eventBlackout = contextService.create({
  symbol: "EUR_USD",
  assetClass: "forex",
  observedAt: "2026-01-15T12:45:00.000Z",
  calendarFreshAsOf: "2026-01-15T12:00:00.000Z",
  events: [{
    id: "cpi",
    category: "macro",
    impact: "high",
    startsAt: "2026-01-15T13:00:00.000Z",
    endsAt: "2026-01-15T13:05:00.000Z",
    symbols: ["EURUSD"],
  }],
});
assert.equal(eventBlackout.context.eventProximity, "blackout");
assert.equal(eventBlackout.context.economicReleaseProximity, "blackout");
assert.ok(eventBlackout.context.warnings.some((warning) => warning.includes("blackout")));
assert.ok(eventBlackout.events.some((event) => event.eventType === MarketContextV2EventTypes.EventRiskWindowStarted));

const earningsWatch = contextService.create({
  symbol: "AAPL",
  assetClass: "stock",
  observedAt: "2026-01-15T12:00:00.000Z",
  events: [{
    id: "aapl-earnings",
    category: "earnings",
    impact: "medium",
    startsAt: "2026-01-15T20:00:00.000Z",
    symbols: ["AAPL"],
  }],
});
assert.equal(earningsWatch.context.earningsProximity, "watch");

const stale = contextService.create({
  symbol: "EUR_USD",
  assetClass: "forex",
  observedAt: "2026-01-15T12:00:00.000Z",
  quote: marketData.normalizeQuote({
    symbol: "EUR_USD",
    bid: 1.1,
    ask: 1.2,
    provider: "fixture",
    observedAt: "2026-01-13T12:00:00.000Z",
    sourceReceivedAt: "2026-01-13T12:00:00.000Z",
  }),
  calendarFreshAsOf: "2026-01-13T12:00:00.000Z",
});
assert.equal(stale.context.dataQualityState, "stale");
assert.equal(stale.context.spreadState, "wide");
assert.equal(stale.context.liquidityState, "thin");
assert.ok(stale.context.warnings.some((warning) => warning.includes("Calendar data is stale")));

const rollover = contextService.create({
  symbol: "XAU_USD",
  assetClass: "metal",
  observedAt: "2026-01-15T22:05:00.000Z",
});
assert.equal(rollover.context.rollover, true);

console.log("v2 phase 2 market-context tests passed");
