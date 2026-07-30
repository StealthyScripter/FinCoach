export type ObservationEvidence = {
  evidenceId: string;
  sourceType: "chart" | "feature" | "context" | "fundamental" | "market_data";
  sourceEventId: string;
  fact: string;
  value: unknown;
  observedAt: string;
  symbol?: string;
  timeframe?: string;
  detectorId?: string;
  detectorVersion?: string;
  observationType?: string;
  candleStart?: string;
  candleEnd?: string;
  marketDataSource?: string;
  sourceDataIds?: string[];
  sourceDataHash?: string;
  detectorParameters?: Record<string, unknown>;
  crossMarket?: boolean;
};

export type ObservationScoreComponents = {
  detectorStrength: number;
  dataCompleteness: number;
  freshness: number;
  contradictionPenalty: number;
  timeframeAgreement?: number;
  sampleSize?: number;
  spreadQuality?: number;
  sourceLineage?: number;
};

export type ObservationMetrics = Partial<{
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  volume: number;
  spread: number;
  atr: number;
  realizedVolatility: number;
  compressionRatio: number;
  breakoutLevel: number;
  breakoutDistance: number;
  movingAverages: Record<string, number>;
  return1: number;
  returnN: number;
  sampleSize: number;
}>;

export type MarketObservation = {
  observationId: string;
  schemaVersion: "fincoach.v2.observation.1";
  symbol: string;
  timeframe: string;
  observationType: string;
  detectorId: string;
  detectorVersion: string;
  strategyFamily?: string;
  observedAt: string;
  candleStart?: string;
  candleEnd?: string;
  lookbackStart?: string;
  lookbackEnd?: string;
  marketDataSource?: string;
  sourceDataIds?: string[];
  sourceDataHash?: string;
  inputSnapshotId?: string;
  detectorParameters?: Record<string, unknown>;
  naturalKey?: string;
  idempotencyKey?: string;
  metrics?: ObservationMetrics;
  effectiveFrom: string;
  expiresAt: string;
  evidence: ObservationEvidence[];
  contradictoryEvidence: ObservationEvidence[];
  confidence: number;
  qualityScore: number;
  scoreComponents?: ObservationScoreComponents;
  contextEventId: string;
  upstreamEventIds: string[];
  correlationId: string;
  causationId: string | null;
  lifecycle: "active" | "expired" | "contradicted" | "superseded" | "invalidated";
  supersedesId?: string | null;
};

export type ObservationInput = {
  symbol: string;
  timeframe: string;
  observedAt: string;
  candleStart?: string;
  candleEnd?: string;
  lookbackStart?: string;
  lookbackEnd?: string;
  marketDataSource?: string;
  sourceDataIds?: string[];
  sourceDataHash?: string;
  inputSnapshotId?: string;
  metrics?: ObservationMetrics;
  detectorParameters?: Record<string, unknown>;
  contextEventId: string;
  upstreamEventIds: string[];
  correlationId: string;
  causationId: string | null;
  evidence: ObservationEvidence[];
  contradictoryEvidence?: ObservationEvidence[];
};

export type DetectorCapability = {
  detectorId: string;
  detectorVersion: string;
  strategyFamily: string;
  supportedTimeframes: string[];
  requiredCandles: number;
  requiredFields: string[];
  minimumDataQuality: number;
  enabled: boolean;
};

export type ObservationDetector = {
  detectorId: string;
  detectorVersion: string;
  capability?: DetectorCapability;
  detect(input: ObservationInput): MarketObservation[];
};
