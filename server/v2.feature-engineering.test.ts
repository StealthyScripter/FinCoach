import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { ChartAnalysisV2Service } from "./v2/chart-analysis";
import { FeatureEngineeringV2EventTypes, FeatureEngineeringV2Service, InMemoryFeatureEngineeringRepository, registeredFeatureIds } from "./v2/feature-engineering";
import { MarketContextV2Service } from "./v2/market-context";
import { MarketDataV2Service } from "./v2/market-data";

const marketData = new MarketDataV2Service();
const chart = new ChartAnalysisV2Service();
const context = new MarketContextV2Service();
const repo = new InMemoryFeatureEngineeringRepository();
const service = new FeatureEngineeringV2Service(repo);
const start = Date.parse("2026-01-01T00:00:00.000Z");

const history = Array.from({ length: 8 }, (_, shift) => {
  const candles = Array.from({ length: 30 }, (_, index) => marketData.normalizeCandle({
    symbol: "EUR_USD",
    timeframe: "1h",
    timestamp: new Date(start + (shift * 30 + index) * 60 * 60_000),
    open: 1.1 + (shift + index) * 0.0002,
    high: 1.101 + (shift + index) * 0.0002,
    low: 1.099 + (shift + index) * 0.0002,
    close: 1.1005 + (shift + index) * 0.0002,
    volume: 100 + shift + index,
    provider: "fixture",
  }));
  return chart.compute({ symbol: "EUR_USD", timeframe: "1h", candles }).features;
});
const quote = marketData.normalizeQuote({ symbol: "EUR_USD", bid: 1.1, ask: 1.1002, provider: "fixture", observedAt: history.at(-1)!.computedAt });
const ctx = context.create({ symbol: "EUR_USD", assetClass: "forex", observedAt: history.at(-1)!.computedAt, quote, higherTimeframeDirection: "up" }).context;
const correlationId = randomUUID();
const causationId = randomUUID();
const inputEventIds = [causationId];

const computed = await service.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: history.at(-1)!.computedAt, chartFeatureHistory: history, contextHistory: [ctx], inputEventIds, correlationId, causationId });
assert.equal(computed.events[0].eventType, FeatureEngineeringV2EventTypes.FeatureVectorComputed);
assert.equal(computed.vector.correlationId, correlationId);
assert.equal(computed.vector.causationId, causationId);
assert.ok(computed.vector.features.every((feature) => registeredFeatureIds().has(feature.featureId)));
assert.ok(computed.vector.features.every((feature) => feature.value === null || typeof feature.value !== "number" || Number.isFinite(feature.value)));
const percentile = computed.vector.features.find((feature) => feature.featureId === "rsi_percentile")!;
assert.ok(Number(percentile.value) >= 0 && Number(percentile.value) <= 1);
assert.equal(computed.vector.features.find((feature) => feature.featureId === "atr_zscore")!.missingDataState, "complete");

const repeated = await service.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: history.at(-1)!.computedAt, chartFeatureHistory: history, contextHistory: [ctx], inputEventIds, correlationId, causationId });
assert.deepEqual(repeated.vector, computed.vector);
assert.deepEqual(await repo.findById(computed.vector.vectorId), computed.vector);

const constantHistory = history.map((item) => ({ ...item, volatility: { ...item.volatility, atr: 1 }, momentum: { ...item.momentum, rsi: 50 } }));
const constant = await service.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: history.at(-1)!.computedAt, chartFeatureHistory: constantHistory, contextHistory: [ctx], inputEventIds: [randomUUID()], correlationId: randomUUID(), causationId: null });
assert.equal(constant.vector.features.find((feature) => feature.featureId === "atr_zscore")!.value, 0);
assert.equal(constant.vector.features.find((feature) => feature.featureId === "atr_robust_zscore")!.value, 0);

await assert.rejects(() => service.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: history[0].computedAt, chartFeatureHistory: history, contextHistory: [ctx], inputEventIds, correlationId, causationId }), /future input/);
await assert.rejects(() => service.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: history.at(-1)!.computedAt, chartFeatureHistory: [{ ...history[0], volatility: { ...history[0].volatility, atr: Number.NaN } }], contextHistory: [], inputEventIds, correlationId, causationId }), /non-finite|Expected/);
assert.equal("submitOrder" in service, false);

console.log("v2 phase 3.5 feature-engineering tests passed");
