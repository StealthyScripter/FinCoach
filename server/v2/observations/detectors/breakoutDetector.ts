import { randomUUID } from "crypto";
import type { MarketObservation, ObservationDetector, ObservationInput } from "../contracts";
import { confidence } from "../evidence";

export const breakoutDetector: ObservationDetector = {
  detectorId: "breakout",
  detectorVersion: "observation-detector.v1",
  detect(input: ObservationInput): MarketObservation[] {
    const support = input.evidence.filter((item) => ["structure.breakOfStructure", "volatility.expansion"].includes(item.fact) && item.value === true);
    if (!support.some((item) => item.fact === "structure.breakOfStructure")) return [];
    return [make(input, "breakout", support)];
  },
};
function make(input: ObservationInput, type: string, evidence = input.evidence): MarketObservation {
  return { observationId: randomUUID(), schemaVersion: "fincoach.v2.observation.1", symbol: input.symbol, timeframe: input.timeframe, observationType: type, observedAt: input.observedAt, effectiveFrom: input.observedAt, expiresAt: new Date(Date.parse(input.observedAt) + 2 * 60 * 60_000).toISOString(), evidence, contradictoryEvidence: input.contradictoryEvidence ?? [], confidence: confidence(evidence, input.contradictoryEvidence ?? []), qualityScore: 1, contextEventId: input.contextEventId, upstreamEventIds: input.upstreamEventIds, detectorId: breakoutDetector.detectorId, detectorVersion: breakoutDetector.detectorVersion, correlationId: input.correlationId, causationId: input.causationId, lifecycle: "active" };
}
