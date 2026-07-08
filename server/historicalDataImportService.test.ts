import assert from "node:assert/strict";
import { HistoricalDataImportService } from "./historicalDataImportService";

const service = new HistoricalDataImportService();
const csv = [
  "timestamp,instrument,timeframe,open,high,low,close,volume,spread",
  "2026-01-01T00:00:00.000Z,EUR/USD,15m,1.1000,1.1005,1.0998,1.1002,100,0.0001",
  "2026-01-01T00:15:00.000Z,EUR/USD,15m,1.1002,1.1006,1.1000,1.1003,101,0.0001",
  "2026-01-01T00:15:00.000Z,EUR/USD,15m,1.1002,1.1006,1.1000,1.1003,101,0.0001",
  "2026-01-01T01:00:00.000Z,EUR/USD,15m,1.1003,1.1040,1.0990,1.1030,102,0.0001",
  "2026-01-01T08:00:00.000Z,EUR/USD,15m,1.1030,1.1034,1.1028,1.1032,103,0.0001",
].join("\n");

const status = service.importCsv({ csv, now: new Date("2026-01-01T09:00:00.000Z") });
assert.equal(status.source, "csv");
assert.equal(status.imported, 4);
assert.equal(status.duplicatesRemoved, 1);
assert.equal(status.rejected, 0);

const candles = service.getCandles("EUR/USD", "15m");
assert.equal(candles.length, 4);
assert.equal(candles[0].instrument, "EUR_USD");
assert.deepEqual(candles.map((candle) => candle.timestamp), [...candles.map((candle) => candle.timestamp)].sort());
assert.ok(candles.some((candle) => candle.session === "asia"));
assert.ok(candles.some((candle) => candle.session === "london"));
assert.ok(candles.some((candle) => candle.volatility === "expanded"));

const coverage = service.coverage("EUR/USD", "15m");
assert.equal(coverage.candlesAvailable, 4);
assert.ok(coverage.gaps.length >= 1);
assert.ok(coverage.warnings.some((warning) => /gap|Only|coverage/i.test(warning)));

const sampleDepth = service.sampleDepth(candles);
assert.equal(sampleDepth.candlesAvailable, 4);
assert.deepEqual(sampleDepth.instrumentsCovered, ["EUR_USD"]);
assert.deepEqual(sampleDepth.timeframesCovered, ["15m"]);
assert.ok(sampleDepth.sessionsCovered.includes("asia"));
assert.ok(sampleDepth.missingDataWarnings.length >= 1);

assert.throws(() => service.importCsv({ csv: "timestamp,open,high,low\nbad,1,2,0" }), /close headers/);
assert.throws(() => service.importCsv({
  csv: "timestamp,instrument,timeframe,open,high,low,close\nbad,EUR/USD,15m,1,2,0,1",
}), /rejected all rows|Invalid time value/);

const providerService = new HistoricalDataImportService();
const providerStatus = await providerService.importFromProvider({
  instrument: "GBP/USD",
  timeframe: "15m",
  count: 2,
  now: new Date("2026-01-01T09:00:00.000Z"),
  provider: {
    async fetchCandles(input) {
      assert.equal(input.instrument, "GBP_USD");
      return [
        { instrument: "GBP_USD", timeframe: "15m", timestamp: "2026-01-01T07:00:00.000Z", open: 1.28, high: 1.281, low: 1.279, close: 1.2805, volume: 10, spread: 0.0002 },
        { instrument: "GBP_USD", timeframe: "15m", timestamp: "2026-01-01T07:15:00.000Z", open: 1.2805, high: 1.282, low: 1.28, close: 1.2815, volume: 11, spread: 0.0002 },
      ];
    },
  },
});
assert.equal(providerStatus.source, "provider");
assert.equal(providerStatus.imported, 2);
assert.equal(providerService.coverage("GBP/USD", "15m").sessionsCovered[0], "london");

providerService.ensureDemoHistory({
  instruments: ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"],
  timeframe: "15m",
  count: 180,
  now: new Date("2026-01-02T00:00:00.000Z"),
});
for (const instrument of ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"]) {
  assert.ok(providerService.coverage(instrument, "15m").candlesAvailable >= 180);
}

console.log("historicalDataImportService tests passed");
