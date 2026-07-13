import assert from "node:assert/strict";
import { ChartAnalysisV2EventTypes, ChartAnalysisV2Service } from "./v2/chart-analysis";
import { MarketDataV2Service, type NormalizedCandle } from "./v2/market-data";

const marketData = new MarketDataV2Service();
const chart = new ChartAnalysisV2Service();
const base = Date.parse("2026-01-01T00:00:00.000Z");

const closes = [
  1.1000, 1.1010, 1.0990, 1.1020, 1.0980,
  1.1030, 1.0995, 1.1040, 1.1000, 1.1050,
  1.1010, 1.1060, 1.1020, 1.1070, 1.1030,
  1.1080, 1.1040, 1.1090, 1.1050, 1.1120,
  1.1060, 1.1130, 1.1070, 1.1140, 1.1080,
  1.1160, 1.1090, 1.1180, 1.1100, 1.1190,
];

const candles: NormalizedCandle[] = closes.map((close, index) => {
  const sweep = index === closes.length - 1;
  const open = close - 0.0004;
  return marketData.normalizeCandle({
    symbol: "EUR_USD",
    timeframe: "1h",
    timestamp: new Date(base + index * 60 * 60_000),
    open,
    high: sweep ? 1.123 : close + 0.0007,
    low: sweep ? 1.108 : close - 0.0007,
    close: sweep ? 1.12 : close,
    volume: 100 + index,
    provider: "fixture",
  });
});

const result = chart.compute({
  symbol: "EUR_USD",
  timeframe: "1h",
  candles,
  featureDefinitionVersion: "test.chart.v1",
});

assert.equal(result.features.featureDefinitionVersion, "test.chart.v1");
assert.ok(result.features.structure.swings.length >= 4);
assert.equal(result.features.structure.breakOfStructure, true);
assert.equal(result.features.volatility.expansion, true);
assert.ok(result.features.volatility.atr > 0);
assert.ok(result.features.momentum.rsi !== null);
assert.ok(result.features.momentum.macd !== null);
assert.ok(result.features.momentum.adx !== null);
assert.ok(result.features.participation.vwap !== null);
assert.ok(result.features.participation.relativeVolume !== null);
assert.equal(result.features.liquidity.sweep, true);
assert.ok(result.events.some((event) => event.eventType === ChartAnalysisV2EventTypes.TechnicalFeatureComputed));
assert.ok(result.events.some((event) => event.eventType === ChartAnalysisV2EventTypes.BreakoutDetected));
assert.ok(result.events.some((event) => event.eventType === ChartAnalysisV2EventTypes.LiquiditySweepDetected));

const repeated = chart.compute({
  symbol: "EUR_USD",
  timeframe: "1h",
  candles,
  featureDefinitionVersion: "test.chart.v1",
});
assert.deepEqual(
  {
    structure: repeated.features.structure,
    volatility: repeated.features.volatility,
    momentum: repeated.features.momentum,
    participation: repeated.features.participation,
    liquidity: repeated.features.liquidity,
  },
  {
    structure: result.features.structure,
    volatility: result.features.volatility,
    momentum: result.features.momentum,
    participation: result.features.participation,
    liquidity: result.features.liquidity,
  },
);

assert.throws(() => chart.compute({
  symbol: "EUR_USD",
  timeframe: "1h",
  candles: [candles[1], candles[0], ...candles.slice(2)],
}), /strictly ordered/);

const warmup = chart.compute({
  symbol: "EUR_USD",
  timeframe: "1h",
  candles: candles.slice(0, 5),
});
assert.equal(warmup.features.momentum.rsi, null);
assert.equal(warmup.features.momentum.macd, null);

const incompleteIncluded = chart.compute({
  symbol: "EUR_USD",
  timeframe: "1h",
  candles: [...candles.slice(0, 5), { ...candles[5], complete: false }],
});
assert.equal(incompleteIncluded.features.computedAt, candles[4].timestamp);

const gapCandles = candles.slice(0, 8).map((candle, index) => index === 7
  ? { ...candle, low: candles[6].high + 0.001, high: candles[6].high + 0.002, open: candles[6].high + 0.0012, close: candles[6].high + 0.0015 }
  : candle);
const gap = chart.compute({ symbol: "EUR_USD", timeframe: "1h", candles: gapCandles });
assert.equal(gap.features.volatility.gap, true);
assert.equal(gap.features.liquidity.fairValueGapCandidate, true);

console.log("v2 phase 3 chart-analysis tests passed");
