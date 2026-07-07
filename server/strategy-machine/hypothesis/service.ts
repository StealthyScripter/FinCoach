import { createHash } from "crypto";
import { createEvent, type EventEnvelope, type EventReference } from "../core";
import type { DetectedPattern, PatternType } from "../pattern-discovery";
import { HypothesisEventTypes } from "./events";
import type { Hypothesis } from "./contracts";
import { HypothesisRepository } from "./repository";

export class HypothesisService {
  constructor(private readonly repository = new HypothesisRepository()) {}

  fromPatterns(patternEvents: EventEnvelope[]) {
    const patterns = patternEvents
      .filter((event) => event.type === "PatternDetected")
      .map((event) => event.payload as unknown as DetectedPattern);
    if (patterns.length === 0) {
      return createEvent({
        type: HypothesisEventTypes.HypothesisRejected,
        module: "hypothesis",
        payload: { reason: "no_detected_patterns", patternCount: 0 },
        sourceEventRefs: patternEvents.map(referenceFrom),
      });
    }
    const instrument = patterns[0].instrument;
    const timeframe = patterns[0].timeframe;
    const types = Array.from(new Set(patterns.map((pattern) => pattern.patternType)));
    const score = scorePatterns(patterns);
    const requiredSampleSize = estimateSampleSize(score, types.length);
    const status = patterns.length < 2 ? "needs_more_data" : score < 0.62 ? "rejected" : "created";
    const hypothesis: Hypothesis = {
      hypothesisId: stableId(instrument, timeframe, types),
      statement: statementFor(instrument, timeframe, types),
      instrument,
      timeframe,
      patternTypes: types,
      supportedMarkets: marketFor(instrument),
      regimeTags: regimeTags(types),
      score,
      requiredSampleSize,
      status,
      rejectionReason: status === "rejected" ? "pattern evidence score below threshold" : null,
      sourcePatternRefs: patternEvents.filter((event) => event.type === "PatternDetected").map(referenceFrom),
    };
    if (status !== "rejected") this.repository.save(hypothesis);
    return createEvent({
      type: status === "created" ? HypothesisEventTypes.HypothesisCreated : status === "needs_more_data" ? HypothesisEventTypes.HypothesisNeedsMoreData : HypothesisEventTypes.HypothesisRejected,
      module: "hypothesis",
      payload: hypothesis as unknown as Record<string, unknown>,
      sourceEventRefs: hypothesis.sourcePatternRefs,
    });
  }
}

function scorePatterns(patterns: DetectedPattern[]) {
  return Number((patterns.reduce((sum, pattern) => sum + pattern.confidence, 0) / Math.max(patterns.length, 1)).toFixed(4));
}

function estimateSampleSize(score: number, patternCount: number) {
  return Math.max(30, Math.ceil((1 - Math.min(score, 0.9)) * 180 + patternCount * 10));
}

function regimeTags(types: PatternType[]) {
  const tags = new Set<string>();
  if (types.some((type) => type.includes("volatility"))) tags.add("volatility-sensitive");
  if (types.some((type) => type.includes("breakout"))) tags.add("breakout-regime");
  if (types.some((type) => type.includes("pullback") || type.includes("continuation"))) tags.add("trend-regime");
  return Array.from(tags);
}

function marketFor(instrument: string): Hypothesis["supportedMarkets"] {
  if (instrument.startsWith("XAU") || instrument.startsWith("XAG")) return ["metal"];
  if (instrument.includes("_")) return ["forex"];
  return ["stock"];
}

function statementFor(instrument: string, timeframe: string, types: PatternType[]) {
  return `${types.join(" plus ")} behavior on ${instrument} ${timeframe} has positive expectancy when objective filters confirm the regime.`;
}

function stableId(instrument: string, timeframe: string, types: PatternType[]) {
  return createHash("sha1").update([instrument, timeframe, ...types.sort()].join("|")).digest("hex").slice(0, 16);
}

function referenceFrom(event: EventEnvelope): EventReference {
  return {
    eventId: event.id,
    eventType: event.type,
    module: event.module,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
  };
}

export const hypothesisService = new HypothesisService();
