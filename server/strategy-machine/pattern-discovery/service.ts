import { createEvent, type EventReference } from "../core";
import type { Candle } from "../market-data";
import { PatternDiscoveryEventTypes } from "./events";
import type { DetectedPattern, PatternDetectionInput, PatternType } from "./contracts";
import { PatternDiscoveryRepository } from "./repository";

const MIN_CANDLES = 8;

export class PatternDiscoveryService {
  constructor(private readonly repository = new PatternDiscoveryRepository()) {}

  detect(input: PatternDetectionInput) {
    if (input.candles.length < MIN_CANDLES) {
      return [this.rejected(input, "insufficient_data", { required: MIN_CANDLES, actual: input.candles.length })];
    }
    const detectors: Array<[PatternType, (candles: Candle[]) => boolean]> = [
      ["volatility_compression", volatilityCompression],
      ["volatility_expansion", volatilityExpansion],
      ["breakout", breakout],
      ["pullback", pullback],
      ["trend_continuation", trendContinuation],
      ["liquidity_sweep", liquiditySweep],
      ["support_resistance_reaction", supportResistanceReaction],
      ["market_structure_shift", marketStructureShift],
      ["session_breakout", sessionBreakout],
      ["false_breakout", falseBreakout],
    ];
    const events = detectors.map(([type, detector]) => {
      if (!detector(input.candles)) return this.rejected(input, `${type}_not_present`, { patternType: type });
      const pattern = buildPattern(type, input.candles, input.sourceEventRefs);
      this.repository.save(pattern);
      return createEvent({ type: PatternDiscoveryEventTypes.PatternDetected, module: "pattern-discovery", payload: pattern as unknown as Record<string, unknown>, sourceEventRefs: input.sourceEventRefs });
    });
    const detectedRefs = events
      .filter((event) => event.type === PatternDiscoveryEventTypes.PatternDetected)
      .map((event) => ({
        eventId: event.id,
        eventType: event.type,
        module: event.module,
        schemaVersion: event.schemaVersion,
        occurredAt: event.occurredAt,
      })) as EventReference[];
    if (detectedRefs.length >= 2) {
      events.push(createEvent({
        type: PatternDiscoveryEventTypes.PatternClusterCreated,
        module: "pattern-discovery",
        payload: {
          instrument: input.instrument,
          timeframe: input.timeframe,
          patternTypes: this.repository.list().map((pattern) => pattern.patternType),
          count: detectedRefs.length,
          sourceEventRefs: detectedRefs,
        },
        sourceEventRefs: detectedRefs,
      }));
    }
    return events;
  }

  private rejected(input: PatternDetectionInput, reason: string, measurements: Record<string, number | string | boolean>) {
    return createEvent({
      type: PatternDiscoveryEventTypes.PatternRejected,
      module: "pattern-discovery",
      payload: {
        instrument: input.instrument,
        timeframe: input.timeframe,
        reason,
        objectiveMeasurements: measurements,
      },
      sourceEventRefs: input.sourceEventRefs,
    });
  }
}

function buildPattern(patternType: PatternType, candles: Candle[], sourceEventRefs: EventReference[]): DetectedPattern {
  const ranges = candles.map(range);
  const closes = candles.map((candle) => candle.close);
  return {
    patternType,
    instrument: candles[0].instrument,
    timeframe: candles[0].timeframe,
    evidence: {
      windowStart: candles[0].timestamp,
      windowEnd: candles[candles.length - 1].timestamp,
      measurements: {
        averageRange: round(avg(ranges)),
        latestRange: round(ranges[ranges.length - 1]),
        closeChange: round(closes[closes.length - 1] - closes[0]),
        high: round(Math.max(...candles.map((candle) => candle.high))),
        low: round(Math.min(...candles.map((candle) => candle.low))),
      },
    },
    confidence: confidenceFor(patternType, candles),
    invalidationEvidence: [`${patternType} invalidates if price closes back through measured structure.`],
    sourceEventRefs,
  };
}

function volatilityCompression(candles: Candle[]) {
  const ranges = candles.map(range);
  return avg(ranges.slice(-3)) < avg(ranges.slice(0, -3)) * 0.7;
}

function volatilityExpansion(candles: Candle[]) {
  const ranges = candles.map(range);
  return ranges[ranges.length - 1] > avg(ranges.slice(0, -1)) * 1.6;
}

function breakout(candles: Candle[]) {
  const priorHigh = Math.max(...candles.slice(0, -1).map((candle) => candle.high));
  return candles[candles.length - 1].close > priorHigh;
}

function pullback(candles: Candle[]) {
  const closes = candles.map((candle) => candle.close);
  return closes[closes.length - 1] > closes[0] && closes.slice(-3)[0] > closes.slice(-3)[1] && closes.slice(-3)[2] > closes.slice(-3)[1];
}

function trendContinuation(candles: Candle[]) {
  const closes = candles.map((candle) => candle.close);
  return closes[closes.length - 1] > closes[0] && closes.filter((close, index) => index > 0 && close > closes[index - 1]).length >= candles.length * 0.6;
}

function liquiditySweep(candles: Candle[]) {
  const last = candles[candles.length - 1];
  const priorLow = Math.min(...candles.slice(0, -1).map((candle) => candle.low));
  return last.low < priorLow && last.close > priorLow;
}

function supportResistanceReaction(candles: Candle[]) {
  const last = candles[candles.length - 1];
  const lows = candles.slice(0, -1).map((candle) => candle.low);
  const support = Math.min(...lows);
  return Math.abs(last.low - support) <= avg(candles.map(range)) * 0.25 && last.close > last.open;
}

function marketStructureShift(candles: Candle[]) {
  const midpoint = Math.floor(candles.length / 2);
  return avg(candles.slice(0, midpoint).map((candle) => candle.close - candle.open)) < 0
    && avg(candles.slice(midpoint).map((candle) => candle.close - candle.open)) > 0;
}

function sessionBreakout(candles: Candle[]) {
  return breakout(candles) && candles[candles.length - 1].timestamp.includes("T08:");
}

function falseBreakout(candles: Candle[]) {
  const last = candles[candles.length - 1];
  const priorHigh = Math.max(...candles.slice(0, -1).map((candle) => candle.high));
  return last.high > priorHigh && last.close < priorHigh;
}

function confidenceFor(patternType: PatternType, candles: Candle[]) {
  const base = patternType === "false_breakout" || patternType === "liquidity_sweep" ? 0.68 : 0.62;
  return round(Math.min(0.95, base + Math.min(candles.length, 40) / 200));
}

function range(candle: Candle) {
  return candle.high - candle.low;
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const patternDiscoveryService = new PatternDiscoveryService();
