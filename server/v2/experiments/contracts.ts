export type ExperimentStatus = "queued" | "leased" | "running" | "completed" | "failed" | "cancelled" | "expired";
export type ResearchExperiment = {
  experimentId: string; schemaVersion: "fincoach.v2.experiment.1"; hypothesisId: string; strategyId: string; strategyVersion: number;
  experimentType: "baseline_backtest" | "parameter_grid" | "parameter_random_search" | "instrument_holdout" | "timeframe_holdout" | "regime_holdout" | "cost_sensitivity" | "execution_sensitivity" | "walk_forward" | "monte_carlo" | "ablation";
  datasetSpecification: { symbols: string[]; timeframes: string[]; start: string; end: string };
  parameterSpecification: { grid?: Record<string, Array<string | number | boolean>>; randomSamples?: number };
  holdoutPolicy: { trainEnd: string; validationEnd: string; testStart: string; finalHoldoutLocked: true };
  randomSeed: string; resourceBudget: { maxCandles: number; maxRuntimeMs: number }; priority: number; status: ExperimentStatus; attempt: number; maxAttempts: number;
  fingerprint: string; createdAt: string; correlationId: string; causationId: string | null; leaseOwner?: string; leaseExpiresAt?: string;
};
export type ExperimentInput = Omit<ResearchExperiment, "experimentId" | "schemaVersion" | "status" | "attempt" | "fingerprint" | "createdAt"> & { createdAt?: string };
