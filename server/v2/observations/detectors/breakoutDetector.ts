import { randomUUID } from "crypto";
import type { MarketObservation, ObservationDetector, ObservationInput } from "../contracts";
import { evidenceFingerprint, scoreObservation, semanticObservationKey } from "../evidence";

export const breakoutDetector: ObservationDetector = {
  detectorId: "breakout",
  detectorVersion: "observation-detector.v1",
  capability: { detectorId: "breakout", detectorVersion: "observation-detector.v1", strategyFamily: "compression_breakout", supportedTimeframes: ["1m", "5m", "15m", "30m", "1h", "3h", "6h", "1d", "1w"], requiredCandles: 40, requiredFields: ["open", "high", "low", "close"], minimumDataQuality: 0.5, enabled: true },
  detect(input: ObservationInput): MarketObservation[] {
    const support = input.evidence.filter((item) => ["structure.breakOfStructure", "volatility.expansion"].includes(item.fact) && item.value === true);
    if (!support.some((item) => item.fact === "structure.breakOfStructure")) return [];
    return [make(input, "breakout", support)];
  },
};
function make(input: ObservationInput, type: string, evidence = input.evidence): MarketObservation {
  const scored = scoreObservation(input, evidence, input.contradictoryEvidence ?? []);
  const enrichedEvidence = evidence.map(item => ({ ...item, symbol: input.symbol, timeframe: input.timeframe, detectorId: breakoutDetector.detectorId, detectorVersion: breakoutDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, marketDataSource: input.marketDataSource, sourceDataIds: input.sourceDataIds, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters, evidenceId: evidenceFingerprint([{ ...item, symbol: input.symbol, timeframe: input.timeframe, detectorId: breakoutDetector.detectorId, detectorVersion: breakoutDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, marketDataSource: input.marketDataSource, sourceDataIds: input.sourceDataIds, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters }]) }));
  const naturalKey = semanticObservationKey({ symbol: input.symbol, timeframe: input.timeframe, detectorId: breakoutDetector.detectorId, detectorVersion: breakoutDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters });
  return { observationId: randomUUID(), schemaVersion: "fincoach.v2.observation.1", symbol: input.symbol, timeframe: input.timeframe, observationType: type, detectorId: breakoutDetector.detectorId, detectorVersion: breakoutDetector.detectorVersion, strategyFamily: breakoutDetector.capability?.strategyFamily, observedAt: input.observedAt, candleStart: input.candleStart, candleEnd: input.candleEnd, lookbackStart: input.lookbackStart, lookbackEnd: input.lookbackEnd, marketDataSource: input.marketDataSource, sourceDataIds: input.sourceDataIds, sourceDataHash: input.sourceDataHash, inputSnapshotId: input.inputSnapshotId, detectorParameters: input.detectorParameters, naturalKey, idempotencyKey: naturalKey, metrics: input.metrics, effectiveFrom: input.observedAt, expiresAt: new Date(Date.parse(input.observedAt) + 2 * 60 * 60_000).toISOString(), evidence: enrichedEvidence, contradictoryEvidence: input.contradictoryEvidence ?? [], confidence: scored.confidence, qualityScore: scored.qualityScore, scoreComponents: scored.scoreComponents, contextEventId: input.contextEventId, upstreamEventIds: input.upstreamEventIds, correlationId: input.correlationId, causationId: input.causationId, lifecycle: "active", supersedesId: null };
}
