export type NumericBound = { min: number; max: number };

export type EvolvableParentStrategy = {
  strategyId: string;
  strategyVersion: number;
  parameters: Readonly<Record<string, string | number | boolean>>;
  allowedBounds: Readonly<Record<string, NumericBound>>;
  approvedRuleChanges: readonly string[];
  lineageEventIds: readonly string[];
};

export type StrategyMutation = {
  parameter: string;
  from: string | number | boolean;
  to: string | number | boolean;
  reason: string;
};

export type StrategyEvolutionRequest = {
  proposalId: string;
  parent: EvolvableParentStrategy | null;
  evidenceIds: readonly string[];
  mutations: readonly StrategyMutation[];
  ruleChanges: readonly string[];
  createdAt: string;
  correlationId: string;
  causationId: string | null;
};

export type EvolvedStrategyRevisionProposal = {
  proposalId: string;
  schemaVersion: "fincoach.v2.strategy-revision.1";
  parentStrategyId: string;
  parentStrategyVersion: number;
  childStrategyId: string;
  mutations: readonly StrategyMutation[];
  ruleChanges: readonly string[];
  status: "proposed";
  evidenceIds: readonly string[];
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type StrategyEvolutionErrorCode =
  | "missing_parent"
  | "missing_evidence"
  | "missing_mutation"
  | "mutation_out_of_bounds"
  | "invalid_parent_value"
  | "unauthorized_rule_change"
  | "missing_lineage";

export type StrategyEvolutionHealth = {
  module: "strategy-evolution";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.strategy-revision.1";
  checkedAt: string;
  proposalCount: number;
};

export const strategyEvolutionModuleContract = {
  module: "strategy-evolution",
  accepts: ["RevisionProposed", "MlEvidenceCreated"],
  emits: ["StrategyRevisionProposed", "StrategyRevisionRejected", "StrategyRevisionDuplicateSuppressed"],
  ownsTables: ["v2_strategy_revision_proposals"],
  publicContracts: ["StrategyEvolutionRequest", "EvolvedStrategyRevisionProposal", "StrategyEvolutionHealth"],
  schemaVersion: "fincoach.v2.strategy-revision.1",
} as const;
