import assert from "node:assert/strict";
import { analysisToolService } from "./analysisToolService";

const candles = [
  { timestamp: "2026-01-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 10_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:05:00.000Z", open: 100, high: 102, low: 99.5, close: 101, volume: 11_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:10:00.000Z", open: 101, high: 103, low: 100.5, close: 102, volume: 12_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:15:00.000Z", open: 102, high: 104, low: 101, close: 103, volume: 13_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:20:00.000Z", open: 103, high: 105, low: 102, close: 104, volume: 14_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:25:00.000Z", open: 104, high: 106, low: 103, close: 105, volume: 15_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:30:00.000Z", open: 105, high: 107, low: 104, close: 106, volume: 16_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:35:00.000Z", open: 106, high: 108, low: 105, close: 107, volume: 17_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:40:00.000Z", open: 107, high: 109, low: 106, close: 108, volume: 18_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:45:00.000Z", open: 108, high: 110, low: 107, close: 109, volume: 19_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:50:00.000Z", open: 109, high: 111, low: 108, close: 110, volume: 20_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T00:55:00.000Z", open: 110, high: 112, low: 109, close: 111, volume: 21_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:00:00.000Z", open: 111, high: 113, low: 110, close: 112, volume: 22_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:05:00.000Z", open: 112, high: 114, low: 111, close: 113, volume: 23_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:10:00.000Z", open: 113, high: 115, low: 112, close: 114, volume: 24_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:15:00.000Z", open: 114, high: 116, low: 113, close: 115, volume: 25_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:20:00.000Z", open: 115, high: 117, low: 114, close: 116, volume: 26_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:25:00.000Z", open: 116, high: 118, low: 115, close: 117, volume: 27_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:30:00.000Z", open: 117, high: 119, low: 116, close: 118, volume: 28_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:35:00.000Z", open: 118, high: 120, low: 117, close: 119, volume: 29_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:40:00.000Z", open: 119, high: 121, low: 118, close: 120, volume: 30_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:45:00.000Z", open: 120, high: 122, low: 119, close: 121, volume: 31_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:50:00.000Z", open: 121, high: 123, low: 120, close: 122, volume: 32_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T01:55:00.000Z", open: 122, high: 124, low: 121, close: 123, volume: 33_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:00:00.000Z", open: 123, high: 125, low: 122, close: 124, volume: 34_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:05:00.000Z", open: 124, high: 126, low: 123, close: 125, volume: 35_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:10:00.000Z", open: 125, high: 127, low: 124, close: 126, volume: 36_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:15:00.000Z", open: 126, high: 128, low: 125, close: 127, volume: 37_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:20:00.000Z", open: 127, high: 129, low: 126, close: 128, volume: 38_000, session: "london", spread: 0.02 },
  { timestamp: "2026-01-01T02:25:00.000Z", open: 128, high: 130, low: 127, close: 129, volume: 39_000, session: "london", spread: 0.02 },
];

const report = analysisToolService.analyze("EURUSD", candles, { allowedSessions: ["london"], spreadPct: 0.02 });

assert.equal(report.symbol, "EURUSD");
assert.ok(report.movingAverages.sma20 !== null);
assert.ok(report.momentum.rsi14 !== null);
assert.ok(report.momentum.macd !== null);
assert.ok(report.volatility.atr14 !== null);
assert.equal(report.structure.sessionAllowed, true);
assert.equal(report.structure.spreadLiquidity, "good");
assert.equal(report.structure.trend, "uptrend");

console.log("analysisToolService tests passed");
