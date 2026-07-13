import assert from "node:assert/strict";
import {
  InMemoryMarketDataRepository,
  MarketDataV2EventTypes,
  MarketDataV2Service,
  type MarketDataProviderAdapter,
  type NormalizedCandle,
} from "./v2/market-data";

const repository = new InMemoryMarketDataRepository();
const service = new MarketDataV2Service(repository);
const base = new Date("2026-01-15T12:00:00.000Z");

assert.deepEqual(service.normalizeSymbol("eur/usd"), {
  symbol: "EUR_USD",
  assetClass: "forex",
  providerSymbols: { oanda_practice: "EUR_USD", polygon: "EURUSD" },
});
assert.equal(service.normalizeSymbol("xauusd").assetClass, "metal");
assert.equal(service.normalizeSymbol("AAPL").assetClass, "stock");
assert.throws(() => service.normalizeSymbol("BTC/USD"), /Unsupported symbol/);

const quote = service.normalizeQuote({
  symbol: "EUR_USD",
  bid: 1.1,
  ask: 1.1002,
  provider: "oanda_practice",
  observedAt: base,
  sourceReceivedAt: base,
});
assert.equal(quote.mid, 1.1001);
assert.equal(quote.spread, 0.0002);
assert.throws(() => service.normalizeQuote({
  symbol: "EUR_USD",
  bid: 1.2,
  ask: 1.1,
  provider: "oanda_practice",
  observedAt: base,
}), /ask/);

const candles: NormalizedCandle[] = [0, 1, 2, 4].map((step) => service.normalizeCandle({
  symbol: "EUR_USD",
  timeframe: "1m",
  timestamp: new Date(base.getTime() + step * 60_000),
  open: 1.1 + step * 0.0001,
  high: 1.1005 + step * 0.0001,
  low: 1.0995 + step * 0.0001,
  close: 1.1002 + step * 0.0001,
  volume: 100 + step,
  tickVolume: 50 + step,
  spread: 0.00012,
  provider: "oanda_practice",
  adapterVersion: "test.v1",
}));

const stock = service.normalizeCandle({
  symbol: "MSFT",
  timeframe: "1d",
  timestamp: base,
  open: 420,
  high: 425,
  low: 418,
  close: 421,
  volume: 1000000,
  provider: "stock_fixture",
});
assert.equal(stock.corporateAction?.splitAdjusted, false);
assert.throws(() => service.normalizeCandle({
  symbol: "EUR_USD",
  timeframe: "1m",
  timestamp: base,
  open: 1,
  high: 0.9,
  low: 0.8,
  close: 1,
  provider: "fixture",
}), /OHLC/);
assert.throws(() => service.normalizeCandle({
  symbol: "EUR_USD",
  timeframe: "1m",
  timestamp: base,
  open: 0,
  high: 1,
  low: 0.8,
  close: 0.9,
  provider: "fixture",
}), /positive/);

const quality = service.assessQuality(candles, new Date(base.getTime() + 5 * 60_000));
assert.equal(quality.orderingValid, true);
assert.equal(quality.gaps.length, 1);
assert.equal(quality.gaps[0].missingCandles, 1);
assert.equal(quality.fresh, true);
assert.ok(quality.qualityScore < 1);

const unordered = service.assessQuality([candles[1], candles[0]], new Date(base.getTime() + 2 * 60_000));
assert.equal(unordered.orderingValid, false);
assert.ok(unordered.warnings.some((warning) => warning.includes("not strictly ordered")));

const stale = service.assessQuality(candles.slice(0, 1), new Date(base.getTime() + 20 * 60_000));
assert.equal(stale.fresh, false);

const imported = await service.importCandles({
  candles,
  idempotencyKey: "phase1-import",
  now: new Date(base.getTime() + 5 * 60_000),
});
assert.equal(imported.result.status, "imported");
assert.ok(imported.domainEvents.some((event) => event.eventType === MarketDataV2EventTypes.MarketDataImported));
assert.ok(imported.domainEvents.some((event) => event.eventType === MarketDataV2EventTypes.MarketDataGapDetected));
assert.equal(repository.listCandles().length, candles.length);

const duplicate = await service.importCandles({
  candles,
  idempotencyKey: "phase1-import",
  now: new Date(base.getTime() + 5 * 60_000),
});
assert.equal(duplicate.result.status, "duplicate");
assert.equal(duplicate.domainEvents.length, 0);
assert.equal(repository.listCandles().length, candles.length);

let providerCalls = 0;
const adapter: MarketDataProviderAdapter = {
  id: "oanda_practice",
  assetClasses: ["forex", "metal"],
  adapterVersion: "adapter.test.v1",
  async fetchCandles(input) {
    providerCalls += 1;
    assert.equal(input.symbol.symbol, "GBP_USD");
    assert.equal(input.cursor, providerCalls === 1 ? null : "cursor-2");
    return {
      nextCursor: providerCalls === 1 ? "cursor-2" : null,
      rateLimitedUntil: null,
      candles: [{
        timestamp: base.toISOString(),
        open: 1.25,
        high: 1.251,
        low: 1.249,
        close: 1.2504,
        volume: 10,
        spread: 0.00015,
      }],
    };
  },
};

const page1 = await service.importFromProvider(adapter, { symbol: "GBP/USD", timeframe: "5m", limit: 1 });
assert.equal(page1.nextCursor, "cursor-2");
const page2 = await service.importFromProvider(adapter, { symbol: "GBP/USD", timeframe: "5m", limit: 1 });
assert.equal(page2.nextCursor, null);
assert.equal(providerCalls, 2);

const stockOnlyAdapter: MarketDataProviderAdapter = {
  ...adapter,
  id: "stock_fixture",
  assetClasses: ["stock"],
};
await assert.rejects(
  () => service.importFromProvider(stockOnlyAdapter, { symbol: "EUR_USD", timeframe: "1m", limit: 1 }),
  /does not support forex/,
);

assert.equal("submitOrder" in adapter, false);

console.log("v2 phase 1 market-data tests passed");
