export type StrategyLifecycleState =
  | "draft"
  | "hypothesis"
  | "experiment"
  | "validated"
  | "court-approved"
  | "forward-test"
  | "candidate"
  | "focused"
  | "paused"
  | "degraded"
  | "retired"
  | "archived";

export type StrategyLifecycleMetrics = {
  expectancy: number;
  drawdown: number;
  calibration: number;
  evidenceAgeDays: number;
  regimeMismatch: number;
  externalDisagreement: number;
  edgeDecay: number;
};

export type StrategyLifecycleDecision = {
  decisionId: string;
  schemaVersion: "fincoach.v2.strategy-lifecycle.1";
  strategyId: string;
  fromState: StrategyLifecycleState | null;
  toState: StrategyLifecycleState;
  reason: string;
  metrics: StrategyLifecycleMetrics;
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type StrategyLifecycleDecisionInput = Omit<StrategyLifecycleDecision, "schemaVersion">;

export type StrategyDecayEvaluationInput = {
  decisionId: string;
  strategyId: string;
  currentState: StrategyLifecycleState;
  metrics: StrategyLifecycleMetrics;
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type StrategyLifecycleErrorCode = "missing_lineage" | "missing_required_field" | "forbidden_transition" | "invalid_metrics";

export type StrategyLifecycleHealth = {
  module: "strategy-lifecycle";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.strategy-lifecycle.1";
  checkedAt: string;
  decisionCount: number;
};

export const strategyLifecycleModuleContract = {
  module: "strategy-lifecycle",
  accepts: ["StrategyRevisionProposed", "MlEvidenceCreated", "ExternalEvaluationReceived"],
  emits: ["StrategyPromoted", "StrategyPaused", "StrategyDegraded", "StrategyRetired", "StrategyRecovered", "StrategyLifecycleRejected", "StrategyLifecycleDuplicateSuppressed"],
  ownsTables: ["v2_strategy_lifecycle_decisions"],
  publicContracts: ["StrategyLifecycleDecisionInput", "StrategyLifecycleDecision", "StrategyLifecycleHealth"],
  schemaVersion: "fincoach.v2.strategy-lifecycle.1",
} as const;
