export type ObservationEvidence = {
  evidenceId: string;
  sourceType: "chart" | "feature" | "context" | "fundamental";
  sourceEventId: string;
  fact: string;
  value: unknown;
  observedAt: string;
};

export type MarketObservation = {
  observationId: string;
  schemaVersion: "fincoach.v2.observation.1";
  symbol: string;
  timeframe: string;
  observationType: string;
  observedAt: string;
  effectiveFrom: string;
  expiresAt: string;
  evidence: ObservationEvidence[];
  contradictoryEvidence: ObservationEvidence[];
  confidence: number;
  qualityScore: number;
  contextEventId: string;
  upstreamEventIds: string[];
  detectorId: string;
  detectorVersion: string;
  correlationId: string;
  causationId: string | null;
  lifecycle: "active" | "expired" | "contradicted" | "superseded" | "invalidated";
};

export type ObservationInput = {
  symbol: string;
  timeframe: string;
  observedAt: string;
  contextEventId: string;
  upstreamEventIds: string[];
  correlationId: string;
  causationId: string | null;
  evidence: ObservationEvidence[];
  contradictoryEvidence?: ObservationEvidence[];
};

export type ObservationDetector = {
  detectorId: string;
  detectorVersion: string;
  detect(input: ObservationInput): MarketObservation[];
};
