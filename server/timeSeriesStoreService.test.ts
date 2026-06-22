import assert from "node:assert/strict";
import { InMemoryTimeSeriesStore, TimescaleReadyStore } from "./timeSeriesStoreService";

const store = new InMemoryTimeSeriesStore();
await store.writePriceBars([
  { symbol: "SPY", timestamp: "2026-01-15T14:00:00.000Z", open: 540, high: 550, low: 538, close: 548, volume: 1000 },
]);
await store.writeEconomicObservations([{ seriesId: "DGS2", timestamp: "2026-01-15T14:00:00.000Z", value: 4.7, source: "test" }]);
await store.writeOptionsSnapshots([{ underlying: "SPY", timestamp: "2026-01-15T14:00:00.000Z", impliedVolatilityPct: 18, openInterest: 100 }]);
await store.recordIngestionRun({
  id: "run-1",
  providerId: "market",
  status: "success",
  startedAt: "2026-01-15T14:00:00.000Z",
  completedAt: "2026-01-15T14:01:00.000Z",
  records: 1,
  freshness: { newestTimestamp: "2026-01-15T14:00:00.000Z", oldestTimestamp: "2026-01-15T14:00:00.000Z" },
  errors: [],
});

const bars = await store.queryPriceBars("SPY", "2026-01-15T13:00:00.000Z", "2026-01-15T15:00:00.000Z");
assert.equal(bars.length, 1);
assert.equal(store.health().priceBars, 1);
assert.equal(store.health().ingestionRuns, 1);
assert.equal((await store.listPriceBars()).length, 1);
assert.equal((await store.listEconomicObservations()).length, 1);
assert.equal((await store.listOptionsSnapshots()).length, 1);
assert.equal((await store.listIngestionRuns()).length, 1);

const timescale = new TimescaleReadyStore();
assert.ok(["disabled", "healthy"].includes(timescale.health().status));

console.log("timeSeriesStoreService smoke tests passed");
