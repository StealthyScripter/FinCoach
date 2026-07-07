import assert from "node:assert/strict";
import { StrategyMachineCoreService, createEvent, toEventReference, validateEventReferences, InMemoryEventRepository } from "./strategy-machine/core";
import { MarketDataService, normalizeInstrument, type Candle } from "./strategy-machine/market-data";
import { PatternDiscoveryService } from "./strategy-machine/pattern-discovery";

const repository = new InMemoryEventRepository();
const core = new StrategyMachineCoreService(repository);

const registered = core.registerModule("market-data");
assert.equal(registered.module, "core");
assert.equal(registered.type, "strategy-machine.core.ModuleRegistered");
assert.ok(core.registry().some((module) => module.name === "market-data"));
assert.ok(core.eventCatalog().includes("PatternDetected"));

const snapshot = createEvent({
  type: "MarketSnapshotCreated",
  module: "market-data",
  payload: { instrument: "EUR_USD", bid: 1.1, ask: 1.1002 },
  correlationId: registered.correlationId,
  causationId: registered.id,
  sourceEventRefs: [toEventReference(registered)],
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
});
repository.append(snapshot);

assert.equal(snapshot.contractVersion, 1);
assert.equal(snapshot.schemaVersion, "strategy-machine.v1");
assert.equal(snapshot.causationId, registered.id);
assert.equal(snapshot.sourceEventRefs[0].eventId, registered.id);
assert.equal(validateEventReferences(snapshot.sourceEventRefs), true);
assert.equal(core.validateLineage(snapshot.id), true);

assert.throws(() => {
  (snapshot.payload as Record<string, unknown>).bid = 9;
}, /read only|Cannot assign/);

assert.throws(() => validateEventReferences([toEventReference(snapshot), toEventReference(snapshot)]), /Duplicate/);
assert.throws(() => core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "repository" }), /boundary/);
assert.equal(core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "contract" }), true);

console.log("strategy machine core tests passed");

const marketData = new MarketDataService();
assert.equal(normalizeInstrument("EUR/USD"), "EUR_USD");
assert.equal(marketData.assertSupported("xau/usd").symbol, "XAU_USD");
assert.throws(() => marketData.assertSupported("BTC/USD"), /Unsupported instrument/);

const marketSnapshot = marketData.createSnapshot({
  instrument: "EUR/USD",
  bid: 1.1,
  ask: 1.1002,
  provider: "mock",
  observedAt: new Date("2026-01-01T08:00:00.000Z"),
});
assert.equal(marketSnapshot.type, "MarketSnapshotCreated");
assert.equal(marketSnapshot.payload.mid, 1.1001);

const spread = marketData.detectSpread(marketSnapshot);
assert.equal(spread.type, "SpreadStateDetected");
assert.equal(spread.sourceEventRefs[0].eventId, marketSnapshot.id);

const candles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
  instrument: "EUR_USD",
  timeframe: "15m",
  timestamp: new Date(Date.UTC(2026, 0, 1, 7, index * 15)).toISOString(),
  open: 1.1 + index * 0.0001,
  high: 1.1002 + index * 0.0001,
  low: 1.0999 + index * 0.0001,
  close: 1.1001 + index * 0.0001,
  volume: 100 + index,
}));
const candleSeries = marketData.createCandleSeries(candles);
assert.equal(candleSeries.type, "CandleSeriesCreated");
assert.equal((candleSeries.payload.candles as Candle[]).length, 20);

const session = marketData.detectSession("EUR_USD", new Date("2026-01-01T08:00:00.000Z"));
assert.equal(session.payload.session, "london");

const volatility = marketData.detectVolatility(candles);
assert.equal(volatility.type, "VolatilityStateDetected");
assert.equal(volatility.sourceEventRefs.length, 1);

const economic = marketData.attachEconomicContext("EUR_USD", new Date("2026-01-01T12:30:00.000Z"), [toEventReference(marketSnapshot)]);
assert.equal(economic.payload.blackout, true);
assert.equal(economic.sourceEventRefs[0].eventId, marketSnapshot.id);

console.log("strategy machine market-data tests passed");

const patternDiscovery = new PatternDiscoveryService();
const breakoutCandles: Candle[] = [
  ...Array.from({ length: 9 }, (_, index) => ({
    instrument: "EUR_USD",
    timeframe: "15m" as const,
    timestamp: new Date(Date.UTC(2026, 0, 1, 6, index * 15)).toISOString(),
    open: 1.1 + index * 0.0001,
    high: 1.1005 + index * 0.0001,
    low: 1.0998 + index * 0.0001,
    close: 1.1002 + index * 0.0001,
    volume: 100,
  })),
  {
    instrument: "EUR_USD",
    timeframe: "15m",
    timestamp: "2026-01-01T08:15:00.000Z",
    open: 1.101,
    high: 1.103,
    low: 1.1009,
    close: 1.1028,
    volume: 140,
  },
];
const patternEvents = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles,
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.ok(patternEvents.some((event) => event.type === "PatternDetected" && event.payload.patternType === "breakout"));
assert.ok(patternEvents.every((event) => event.sourceEventRefs.length > 0 || event.type === "PatternClusterCreated"));
const repeated = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles,
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.deepEqual(
  repeated.filter((event) => event.type === "PatternDetected").map((event) => [event.payload.patternType, event.payload.confidence]),
  patternEvents.filter((event) => event.type === "PatternDetected").map((event) => [event.payload.patternType, event.payload.confidence]),
);

const insufficientPatterns = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles.slice(0, 3),
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.equal(insufficientPatterns[0].type, "PatternRejected");
assert.equal(insufficientPatterns[0].payload.reason, "insufficient_data");

console.log("strategy machine pattern-discovery tests passed");
