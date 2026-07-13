import { randomUUID } from "crypto";
import type { MarketObservation, ObservationDetector, ObservationInput } from "../contracts";
import { confidence } from "../evidence";

export const liquiditySweepDetector: ObservationDetector = {
  detectorId: "liquidity-sweep",
  detectorVersion: "observation-detector.v1",
  detect(input: ObservationInput): MarketObservation[] {
    const support = input.evidence.filter((item) => item.fact === "liquidity.sweep" && item.value === true);
    return support.length ? [{ observationId: randomUUID(), schemaVersion: "fincoach.v2.observation.1", symbol: input.symbol, timeframe: input.timeframe, observationType: "liquidity_sweep", observedAt: input.observedAt, effectiveFrom: input.observedAt, expiresAt: new Date(Date.parse(input.observedAt) + 30 * 60_000).toISOString(), evidence: support, contradictoryEvidence: input.contradictoryEvidence ?? [], confidence: confidence(support, input.contradictoryEvidence ?? []), qualityScore: 1, contextEventId: input.contextEventId, upstreamEventIds: input.upstreamEventIds, detectorId: liquiditySweepDetector.detectorId, detectorVersion: liquiditySweepDetector.detectorVersion, correlationId: input.correlationId, causationId: input.causationId, lifecycle: "active" }] : [];
  },
};
