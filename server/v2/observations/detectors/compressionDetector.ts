import { randomUUID } from "crypto";
import type { MarketObservation, ObservationDetector, ObservationInput } from "../contracts";
import { evidenceFingerprint, scoreObservation, semanticObservationKey } from "../evidence";

export const compressionDetector: ObservationDetector = {
  detectorId: "volatility-compression",
  detectorVersion: "observation-detector.v1",
  capability: { detectorId: "volatility-compression", detectorVersion: "observation-detector.v1", strategyFamily: "compression_breakout", supportedTimeframes: ["1m", "5m", "15m", "30m", "1h", "3h", "6h", "1d", "1w"], requiredCandles: 40, requiredFields: ["open", "high", "low", "close"], minimumDataQuality: 0.5, enabled: true },
  detect(input: ObservationInput): MarketObservation[] {
    const match = input.evidence.filter((item) => item.fact === "volatility.compression" && item.value === true);
    if (!match.length) return [];
    return [observation(input, "volatility_compression", match)];
  },
};

function observation(input: ObservationInput, type: string, ev = input.evidence): MarketObservation {
  const scored = scoreObservation(input, ev, input.contradictoryEvidence ?? []);
  const evidence = ev.map(item => ({ ...item, symbol: input.symbol, timeframe: input.timeframe, detectorId: compressionDetector.detectorId, detectorVersion: compressionDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, marketDataSource: input.marketDataSource, sourceDataIds: input.sourceDataIds, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters, evidenceId: evidenceFingerprint([{ ...item, symbol: input.symbol, timeframe: input.timeframe, detectorId: compressionDetector.detectorId, detectorVersion: compressionDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, marketDataSource: input.marketDataSource, sourceDataIds: input.sourceDataIds, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters }]) }));
  const naturalKey = semanticObservationKey({ symbol: input.symbol, timeframe: input.timeframe, detectorId: compressionDetector.detectorId, detectorVersion: compressionDetector.detectorVersion, observationType: type, candleStart: input.candleStart, candleEnd: input.candleEnd, sourceDataHash: input.sourceDataHash, detectorParameters: input.detectorParameters });
  return {
    observationId: randomUUID(),
    schemaVersion: "fincoach.v2.observation.1",
    symbol: input.symbol,
    timeframe: input.timeframe,
    observationType: type,
    detectorId: compressionDetector.detectorId,
    detectorVersion: compressionDetector.detectorVersion,
    strategyFamily: compressionDetector.capability?.strategyFamily,
    observedAt: input.observedAt,
    candleStart: input.candleStart,
    candleEnd: input.candleEnd,
    lookbackStart: input.lookbackStart,
    lookbackEnd: input.lookbackEnd,
    marketDataSource: input.marketDataSource,
    sourceDataIds: input.sourceDataIds,
    sourceDataHash: input.sourceDataHash,
    inputSnapshotId: input.inputSnapshotId,
    detectorParameters: input.detectorParameters,
    naturalKey,
    idempotencyKey: naturalKey,
    metrics: input.metrics,
    effectiveFrom: input.observedAt,
    expiresAt: new Date(Date.parse(input.observedAt) + 60 * 60_000).toISOString(),
    evidence,
    contradictoryEvidence: input.contradictoryEvidence ?? [],
    confidence: scored.confidence,
    qualityScore: scored.qualityScore,
    scoreComponents: scored.scoreComponents,
    contextEventId: input.contextEventId,
    upstreamEventIds: input.upstreamEventIds,
    correlationId: input.correlationId,
    causationId: input.causationId,
    lifecycle: "active",
    supersedesId: null,
  };
}
