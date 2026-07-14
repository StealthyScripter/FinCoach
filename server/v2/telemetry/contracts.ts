export type V2MetricKind = "counter" | "gauge" | "histogram";

export type V2MetricResult = "recorded" | "dropped";

export type V2MetricLabelKey =
  | "module"
  | "operation"
  | "eventType"
  | "resultClass"
  | "errorClass"
  | "schemaVersion"
  | "timeframe"
  | "assetClass"
  | "lifecycleState"
  | "courtroomVerdict"
  | "rejectionCategory"
  | "replayMode"
  | "workerType";

export type V2MetricLabels = Partial<Record<V2MetricLabelKey, string>>;

export type V2MetricSample = {
  name: string;
  kind: V2MetricKind;
  value: number;
  labels: V2MetricLabels;
  recordedAt: string;
};

export type V2OperationalEvent = {
  timestamp: string;
  level: "info" | "warn" | "error";
  module: string;
  operation: string;
  result: string;
  errorClass?: string;
  schemaVersion?: string;
  correlationId?: string;
  causationId?: string | null;
  durationMs?: number;
  retryAttempt?: number;
  workerId?: string;
  details?: Record<string, unknown>;
};

export type V2TelemetrySnapshot = {
  schemaVersion: "fincoach.v2.telemetry-snapshot.1";
  health: V2TelemetryHealth;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { count: number; min: number; max: number; sum: number }>;
  recentEvents: V2OperationalEvent[];
};

export type V2TelemetryHealth = {
  state: "available" | "degraded" | "not_configured";
  lastSuccessfulRecordAt: string | null;
  lastFailedRecordAt: string | null;
  failureClass: string | null;
  droppedMetrics: number;
};

export type V2TelemetrySink = {
  record(sample: V2MetricSample): void;
  event(event: V2OperationalEvent): void;
  snapshot(): V2TelemetrySnapshot;
  health(): V2TelemetryHealth;
};

export type V2TelemetryRecordResult = {
  result: V2MetricResult;
  errorClass?: string;
};
