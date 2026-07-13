import { randomUUID } from "crypto";
import type { MarketObservation, ObservationDetector, ObservationInput } from "../contracts";
import { confidence, evidenceFingerprint } from "../evidence";

export const compressionDetector: ObservationDetector = {
  detectorId: "volatility-compression",
  detectorVersion: "observation-detector.v1",
  detect(input: ObservationInput): MarketObservation[] {
    const match = input.evidence.filter((item) => item.fact === "volatility.compression" && item.value === true);
    if (!match.length) return [];
    return [observation(input, "volatility_compression", match)];
  },
};

function observation(input: ObservationInput, type: string, ev = input.evidence): MarketObservation {
  return {
    observationId: randomUUID(),
    schemaVersion: "fincoach.v2.observation.1",
    symbol: input.symbol,
    timeframe: input.timeframe,
    observationType: type,
    observedAt: input.observedAt,
    effectiveFrom: input.observedAt,
    expiresAt: new Date(Date.parse(input.observedAt) + 60 * 60_000).toISOString(),
    evidence: ev,
    contradictoryEvidence: input.contradictoryEvidence ?? [],
    confidence: confidence(ev, input.contradictoryEvidence ?? []),
    qualityScore: 1,
    contextEventId: input.contextEventId,
    upstreamEventIds: input.upstreamEventIds,
    detectorId: compressionDetector.detectorId,
    detectorVersion: compressionDetector.detectorVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    lifecycle: "active",
  };
}
