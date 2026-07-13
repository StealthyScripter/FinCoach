export type MlPurpose = "regime_classification" | "market_similarity" | "ranking" | "feature_importance" | "volatility_prediction" | "anomaly_detection";
export type MlModelStatus = "active" | "stale" | "rolled_back";

export type TimeWindow = { start: string; end: string };

export type MlModelCard = {
  owner: string;
  limitations: readonly string[];
  intendedUse: string;
};

export type MlModelRecord = {
  modelKey: string;
  schemaVersion: "fincoach.v2.ml-model.1";
  modelId: string;
  modelVersion: string;
  purpose: MlPurpose;
  trainingLineageEventIds: readonly string[];
  features: readonly string[];
  trainWindow: TimeWindow;
  validationWindow: TimeWindow;
  testWindow: TimeWindow;
  calibration: Readonly<Record<string, unknown>>;
  metrics: Readonly<Record<string, number>>;
  modelCard: MlModelCard;
  status: MlModelStatus;
  createdAt: string;
  correlationId: string;
  causationId: string | null;
};

export type MlModelRegistration = Omit<MlModelRecord, "modelKey" | "schemaVersion" | "status">;

export type MlEvidence = {
  evidenceId: string;
  schemaVersion: "fincoach.v2.ml-evidence.1";
  modelId: string;
  modelVersion: string;
  observationId: string;
  purpose: MlPurpose;
  prediction: string;
  confidence: number;
  features: Readonly<Record<string, number>>;
  decisionAuthority: "none";
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type MlEvaluationRequest = {
  modelId: string;
  modelVersion: string;
  observationId: string;
  features: Readonly<Record<string, number>>;
  observedAt: string;
  correlationId: string;
  causationId: string | null;
};

export type MlErrorCode =
  | "missing_required_field"
  | "missing_training_lineage"
  | "temporal_leakage"
  | "calibration_failed"
  | "model_unavailable"
  | "feature_mismatch"
  | "stale_model";

export type MlHealth = {
  module: "ml-support";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.ml-model.1";
  checkedAt: string;
  modelCount: number;
  evidenceCount: number;
};

export const mlSupportModuleContract = {
  module: "ml-support",
  accepts: ["LessonCreated", "RevisionProposed"],
  emits: ["ModelRegistered", "ModelRejected", "MlEvidenceCreated", "ModelDriftDetected", "ModelRolledBack", "ModelDuplicateSuppressed"],
  ownsTables: ["v2_ml_models", "v2_ml_evidence"],
  publicContracts: ["MlModelRegistration", "MlModelRecord", "MlEvidence", "MlHealth"],
  schemaVersion: "fincoach.v2.ml-model.1",
} as const;
