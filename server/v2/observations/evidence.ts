import { createHash } from "crypto";
import type { MarketObservation, ObservationEvidence, ObservationInput, ObservationScoreComponents } from "./contracts";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function evidenceFingerprint(evidence: ObservationEvidence[]) {
  return stableHash(evidence.map((item) => ({
    symbol: item.symbol,
    timeframe: item.timeframe,
    detectorId: item.detectorId,
    detectorVersion: item.detectorVersion,
    observationType: item.observationType,
    sourceType: item.sourceType,
    sourceEventId: item.sourceEventId,
    fact: item.fact,
    value: item.value,
    candleStart: item.candleStart,
    candleEnd: item.candleEnd,
    marketDataSource: item.marketDataSource,
    sourceDataIds: item.sourceDataIds,
    sourceDataHash: item.sourceDataHash,
    detectorParameters: item.detectorParameters,
    crossMarket: item.crossMarket === true,
  })));
}

export function evidence(sourceType: ObservationEvidence["sourceType"], sourceEventId: string, fact: string, value: unknown, observedAt: string, context: Partial<ObservationEvidence> = {}): ObservationEvidence {
  const draft: ObservationEvidence = { evidenceId: "", sourceType, sourceEventId, fact, value, observedAt, ...context };
  return { ...draft, evidenceId: evidenceFingerprint([draft]) };
}

export function confidence(supporting: ObservationEvidence[], contradictory: ObservationEvidence[], quality = 1) {
  const raw = supporting.length / Math.max(1, supporting.length + contradictory.length);
  return Number(Math.max(0, Math.min(1, raw * quality)).toFixed(4));
}

export function semanticObservationKey(input: {
  symbol: string;
  timeframe: string;
  detectorId: string;
  detectorVersion: string;
  observationType: string;
  candleStart?: string;
  candleEnd?: string;
  sourceDataHash?: string;
  detectorParameters?: Record<string, unknown>;
}) {
  return `obs:${stableHash(input)}`;
}

export function scoreObservation(input: ObservationInput, support: ObservationEvidence[], contradictory: ObservationEvidence[] = []): { confidence: number; qualityScore: number; scoreComponents: ObservationScoreComponents } {
  const metrics = input.metrics ?? {};
  const sampleSize = clamp01(Number(metrics.sampleSize ?? 0) / 80);
  const dataCompleteness = clamp01([
    metrics.open,
    metrics.high,
    metrics.low,
    metrics.close,
    input.candleStart,
    input.candleEnd,
    input.sourceDataHash,
  ].filter(value => value !== undefined && value !== null && value !== "").length / 7);
  const ageMs = Math.max(0, Date.parse(input.observedAt) - Date.parse(input.candleEnd ?? input.observedAt));
  const freshness = clamp01(1 - ageMs / (24 * 60 * 60_000));
  const contradictionPenalty = clamp01(contradictory.length / Math.max(1, support.length + contradictory.length));
  const detectorStrength = detectorStrengthFrom(metrics, support.length);
  const spreadQuality = typeof metrics.spread === "number" ? clamp01(1 - Math.abs(metrics.spread) / 0.01) : 0.75;
  const sourceLineage = clamp01(((input.sourceDataIds?.length ?? 0) > 0 ? 0.5 : 0) + (input.sourceDataHash ? 0.5 : 0));
  const qualityScore = clamp01(0.3 * dataCompleteness + 0.25 * freshness + 0.2 * spreadQuality + 0.15 * sourceLineage + 0.1 * sampleSize);
  const confidenceScore = clamp01((0.45 * detectorStrength + 0.2 * sampleSize + 0.2 * dataCompleteness + 0.15 * freshness) * (1 - contradictionPenalty) * Math.max(0.2, qualityScore));
  return {
    confidence: round4(confidenceScore),
    qualityScore: round4(qualityScore),
    scoreComponents: {
      detectorStrength: round4(detectorStrength),
      dataCompleteness: round4(dataCompleteness),
      freshness: round4(freshness),
      contradictionPenalty: round4(contradictionPenalty),
      sampleSize: round4(sampleSize),
      spreadQuality: round4(spreadQuality),
      sourceLineage: round4(sourceLineage),
    },
  };
}

export function completeObservationIdentity(observation: MarketObservation): MarketObservation {
  const naturalKey = semanticObservationKey({
    symbol: observation.symbol,
    timeframe: observation.timeframe,
    detectorId: observation.detectorId,
    detectorVersion: observation.detectorVersion,
    observationType: observation.observationType,
    candleStart: observation.candleStart,
    candleEnd: observation.candleEnd,
    sourceDataHash: observation.sourceDataHash,
    detectorParameters: observation.detectorParameters,
  });
  return {
    ...observation,
    naturalKey: observation.naturalKey ?? naturalKey,
    idempotencyKey: observation.idempotencyKey ?? naturalKey,
    evidence: observation.evidence.map(item => item.evidenceId ? item : { ...item, evidenceId: evidenceFingerprint([item]) }),
  };
}

function detectorStrengthFrom(metrics: Record<string, unknown>, supportCount: number) {
  if (typeof metrics.breakoutDistance === "number") return clamp01(Math.abs(metrics.breakoutDistance) * 1000);
  if (typeof metrics.compressionRatio === "number") return clamp01(1 - metrics.compressionRatio);
  if (typeof metrics.return1 === "number") return clamp01(Math.abs(metrics.return1) * 100);
  return clamp01(0.45 + supportCount * 0.15);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round4(value: number) {
  return Number(clamp01(value).toFixed(4));
}
