import { randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { NormalizedCandle } from "../market-data";
import { chartAnalysisInputSchema, type ChartAnalysisInput, type SwingPoint, type TechnicalFeatureSet } from "./contracts";
import { ChartAnalysisV2EventTypes } from "./events";

export class ChartAnalysisV2Service {
  compute(input: ChartAnalysisInput): { features: TechnicalFeatureSet; events: DomainEvent[] } {
    const parsed = chartAnalysisInputSchema.parse(input);
    assertSorted(parsed.candles);
    const candles = parsed.candles.filter((candle) => candle.complete);
    if (candles.length < 5) throw new Error("Chart analysis requires at least five complete candles");
    const ranges = candles.map((candle) => candle.high - candle.low);
    const closes = candles.map((candle) => candle.close);
    const returns = closes.slice(1).map((close, index) => (close - closes[index]) / closes[index]);
    const swings = swingPoints(candles);
    const latest = candles[candles.length - 1];
    const atr = average(ranges.slice(-14));
    const vwap = volumeWeightedAverage(candles);
    const featureSetId = randomUUID();
    const features: TechnicalFeatureSet = {
      featureSetId,
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      computedAt: latest.timestamp,
      featureDefinitionVersion: parsed.featureDefinitionVersion,
      structure: {
        swings,
        trend: trend(swings),
        breakOfStructure: breakOfStructure(swings, latest),
        changeOfCharacter: changeOfCharacter(swings, latest),
        consolidation: percentile(ranges, ranges[ranges.length - 1]) <= 0.25,
        support: lastSwing(swings, "low")?.price ?? null,
        resistance: lastSwing(swings, "high")?.price ?? null,
      },
      volatility: {
        atr: round(atr),
        realizedVolatility: round(stddev(returns)),
        compression: percentile(ranges, ranges[ranges.length - 1]) <= 0.2,
        expansion: percentile(ranges, ranges[ranges.length - 1]) >= 0.8,
        gap: hasGap(candles),
        rangePercentile: percentile(ranges, ranges[ranges.length - 1]),
        shock: ranges[ranges.length - 1] > average(ranges) * 2,
      },
      momentum: {
        rsi: rsi(closes),
        macd: macd(closes),
        adx: adx(candles),
        rateOfChange: round((latest.close - candles[Math.max(0, candles.length - 6)].close) / candles[Math.max(0, candles.length - 6)].close),
        acceleration: round(acceleration(closes)),
        divergence: divergence(candles, swings),
      },
      participation: {
        volume: latest.volume,
        relativeVolume: relativeVolume(candles),
        vwap,
        distanceFromVwap: vwap === null ? null : round((latest.close - vwap) / vwap),
      },
      liquidity: liquidity(candles, swings),
    };
    const computed = createDomainEvent({
      eventType: ChartAnalysisV2EventTypes.TechnicalFeatureComputed,
      sourceModule: "chart-analysis",
      payload: { featureSetId, symbol: features.symbol, timeframe: features.timeframe, featureDefinitionVersion: features.featureDefinitionVersion },
      occurredAt: new Date(latest.timestamp),
    });
    return { features, events: [computed, ...derivedEvents(features, computed)] };
  }
}

function assertSorted(candles: NormalizedCandle[]) {
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].timestamp <= candles[index - 1].timestamp) throw new Error("Chart candles must be strictly ordered with no look-ahead reordering");
  }
}

function swingPoints(candles: NormalizedCandle[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const next = candles[index + 1];
    if (current.high > previous.high && current.high > next.high) swings.push({ index, timestamp: current.timestamp, kind: "high", price: current.high });
    if (current.low < previous.low && current.low < next.low) swings.push({ index, timestamp: current.timestamp, kind: "low", price: current.low });
  }
  return swings;
}

function trend(swings: SwingPoint[]): TechnicalFeatureSet["structure"]["trend"] {
  const highs = swings.filter((swing) => swing.kind === "high").slice(-2);
  const lows = swings.filter((swing) => swing.kind === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "unknown";
  if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) return "uptrend";
  if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) return "downtrend";
  return "range";
}

function breakOfStructure(swings: SwingPoint[], latest: NormalizedCandle) {
  const resistance = lastSwing(swings, "high");
  const support = lastSwing(swings, "low");
  return Boolean((resistance && latest.close > resistance.price) || (support && latest.close < support.price));
}

function changeOfCharacter(swings: SwingPoint[], latest: NormalizedCandle) {
  const priorTrend = trend(swings.slice(0, -1));
  if (priorTrend === "uptrend") return Boolean(lastSwing(swings, "low") && latest.close < (lastSwing(swings, "low") as SwingPoint).price);
  if (priorTrend === "downtrend") return Boolean(lastSwing(swings, "high") && latest.close > (lastSwing(swings, "high") as SwingPoint).price);
  return false;
}

function lastSwing(swings: SwingPoint[], kind: SwingPoint["kind"]) {
  return swings.filter((swing) => swing.kind === kind).at(-1) ?? null;
}

function hasGap(candles: NormalizedCandle[]) {
  return candles.slice(1).some((candle, index) => candle.low > candles[index].high || candle.high < candles[index].low);
}

function rsi(closes: number[]) {
  if (closes.length < 15) return null;
  const changes = closes.slice(1).map((close, index) => close - closes[index]).slice(-14);
  const gains = changes.filter((change) => change > 0);
  const losses = changes.filter((change) => change < 0).map(Math.abs);
  const avgGain = average(gains);
  const avgLoss = average(losses);
  if (avgLoss === 0) return 100;
  return round(100 - 100 / (1 + avgGain / avgLoss));
}

function macd(closes: number[]) {
  if (closes.length < 26) return null;
  return round(ema(closes, 12) - ema(closes, 26));
}

function adx(candles: NormalizedCandle[]) {
  if (candles.length < 14) return null;
  const directional = candles.slice(1).map((candle, index) => Math.abs(candle.close - candles[index].close) / Math.max(candle.high - candle.low, 0.00000001));
  return round(Math.min(100, average(directional.slice(-14)) * 100));
}

function divergence(candles: NormalizedCandle[], swings: SwingPoint[]): TechnicalFeatureSet["momentum"]["divergence"] {
  const lows = swings.filter((swing) => swing.kind === "low").slice(-2);
  const highs = swings.filter((swing) => swing.kind === "high").slice(-2);
  const roc = candles.slice(-3).map((candle, index, values) => index === 0 ? 0 : candle.close - values[index - 1].close);
  if (lows.length === 2 && lows[1].price < lows[0].price && average(roc) > 0) return "bullish";
  if (highs.length === 2 && highs[1].price > highs[0].price && average(roc) < 0) return "bearish";
  return "none";
}

function relativeVolume(candles: NormalizedCandle[]) {
  const volumes = candles.map((candle) => candle.volume).filter((value): value is number => value !== null);
  if (volumes.length < 2) return null;
  return round(volumes[volumes.length - 1] / average(volumes.slice(0, -1)));
}

function volumeWeightedAverage(candles: NormalizedCandle[]) {
  const withVolume = candles.filter((candle) => candle.volume !== null);
  if (!withVolume.length) return null;
  const totalVolume = withVolume.reduce((sum, candle) => sum + (candle.volume ?? 0), 0);
  return totalVolume === 0 ? null : round(withVolume.reduce((sum, candle) => sum + candle.close * (candle.volume ?? 0), 0) / totalVolume);
}

function liquidity(candles: NormalizedCandle[], swings: SwingPoint[]): TechnicalFeatureSet["liquidity"] {
  const latest = candles[candles.length - 1];
  const high = lastSwing(swings, "high");
  const low = lastSwing(swings, "low");
  const equalHighs = Boolean(high && Math.abs(latest.high - high.price) / latest.close < 0.0005);
  const equalLows = Boolean(low && Math.abs(latest.low - low.price) / latest.close < 0.0005);
  const sweepHigh = Boolean(high && latest.high > high.price && latest.close < high.price);
  const sweepLow = Boolean(low && latest.low < low.price && latest.close > low.price);
  const body = Math.abs(latest.close - latest.open);
  const wick = latest.high - latest.low - body;
  return {
    equalHighs,
    equalLows,
    sweep: sweepHigh || sweepLow,
    falseBreakout: sweepHigh || sweepLow,
    wickRejection: wick > body * 2,
    failedAuction: (sweepHigh || sweepLow) && wick > body,
    stopRunProxy: sweepHigh || sweepLow || equalHighs || equalLows,
    fairValueGapCandidate: hasGap(candles.slice(-3)),
    imbalanceCandidate: (latest.high - latest.low) > average(candles.map((candle) => candle.high - candle.low)) * 1.5,
  };
}

function derivedEvents(features: TechnicalFeatureSet, computed: DomainEvent) {
  const base = {
    sourceModule: "chart-analysis" as const,
    correlationId: computed.correlationId,
    causationId: computed.eventId,
    occurredAt: new Date(features.computedAt),
    metadata: { lineage: [{ eventId: computed.eventId, eventType: computed.eventType, schemaVersion: computed.schemaVersion, sourceModule: computed.sourceModule, occurredAt: computed.occurredAt }] },
  };
  const events: DomainEvent[] = [];
  if (features.structure.breakOfStructure) events.push(createDomainEvent({ ...base, eventType: ChartAnalysisV2EventTypes.BreakoutDetected, payload: { featureSetId: features.featureSetId } }));
  if (features.liquidity.sweep) events.push(createDomainEvent({ ...base, eventType: ChartAnalysisV2EventTypes.LiquiditySweepDetected, payload: { featureSetId: features.featureSetId } }));
  if (features.volatility.compression) events.push(createDomainEvent({ ...base, eventType: ChartAnalysisV2EventTypes.VolatilityCompressionDetected, payload: { featureSetId: features.featureSetId } }));
  if (features.volatility.expansion) events.push(createDomainEvent({ ...base, eventType: ChartAnalysisV2EventTypes.VolatilityExpansionDetected, payload: { featureSetId: features.featureSetId } }));
  if (features.momentum.divergence !== "none") events.push(createDomainEvent({ ...base, eventType: ChartAnalysisV2EventTypes.DivergenceDetected, payload: { featureSetId: features.featureSetId, divergence: features.momentum.divergence } }));
  return events;
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((emaValue, value) => value * multiplier + emaValue * (1 - multiplier), values[0]);
}

function acceleration(values: number[]) {
  if (values.length < 3) return 0;
  const latest = values[values.length - 1] - values[values.length - 2];
  const previous = values[values.length - 2] - values[values.length - 3];
  return latest - previous;
}

function percentile(values: number[], target: number) {
  return round(values.filter((value) => value <= target).length / values.length);
}

function stddev(values: number[]) {
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const chartAnalysisV2Service = new ChartAnalysisV2Service();
