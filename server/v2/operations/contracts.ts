export type V2OperationsCollection =
  | "observations"
  | "hypotheses"
  | "experiments"
  | "backtests"
  | "court-cases"
  | "strategies"
  | "forward-tests"
  | "signals"
  | "evaluations"
  | "journal"
  | "lessons"
  | "models"
  | "lifecycle"
  | "orchestration";

export type V2OperationsQuery = {
  limit?: number;
  offset?: number;
  symbol?: string;
  strategyId?: string;
  status?: string;
  since?: string;
  until?: string;
  correlationId?: string;
};

export type V2OperationsAvailability =
  | "available"
  | "available_empty"
  | "disabled"
  | "blocked"
  | "degraded"
  | "stale"
  | "not_configured"
  | "temporarily_unavailable"
  | "schema_incompatible";

export type V2ModuleAvailabilityDetail = {
  state: V2OperationsAvailability;
  reason: string;
};

export type V2OperationsResponse<TBody extends Record<string, unknown>> = {
  status: number;
  body: TBody;
  events: import("../contracts").DomainEvent[];
};

export type V2ResearchPipelineCounts = {
  observations: number;
  hypotheses: number;
  strategies: number;
  experiments: number;
  backtests: number;
  verdicts: number;
  rankedCandidates: number;
  forwardTests: number;
  signals: number;
  evaluations: number;
  journalEntries: number;
  lessons: number;
  lifecycleDecisions: number;
  pilotScorecards: number;
  detectorEvaluations: {
    recordsCurrentHour: number;
    attemptedCurrentHour: number;
    completedCurrentHour: number;
    duplicatesSuppressedCurrentHour: number;
    failuresCurrentHour: number;
  };
};

export type V2ResearchReadiness = {
  currentStage: string;
  nextStage: string;
  liveExecutionBlocked: true;
  paperExecutionState: string;
  demoExecutionState: string;
};

export type V2ResearchProgress = {
  schemaVersion: "fincoach.v2.research-progress.1";
  status: "ok" | "degraded";
  generatedAt: string;
  source?: "postgresql" | "memory" | "not_configured";
  databaseBacked?: boolean;
  reportingSource?: {
    source: string;
    databaseBacked: boolean;
    degraded: boolean;
    generatedAt: string;
    projectionError?: unknown;
  };
  runtime?: Record<string, unknown>;
  windows?: Record<string, Record<string, unknown>>;
  coverage?: Record<string, unknown>;
  pipeline?: V2ResearchPipelineCounts;
  readiness?: V2ResearchReadiness;
  degraded?: boolean;
  reason?: string;
  projectionError?: string;
  liveExecutionBlocked?: true;
};

export type V2DailyResearchReport = {
  reportId: string;
  schemaVersion: "fincoach.v2.daily-research-report.1";
  reportDate: string;
  observations: number;
  hypotheses: number;
  experiments: number;
  backtests: number;
  courtVerdicts: number;
  rankingChanges: number;
  forwardTests: number;
  signals: number;
  externalEvaluations: number;
  lessons: number;
  lifecycleChanges: number;
  operationalFailures: number;
  deadLetterEvents: number;
  dataGaps: number;
  staleDataIncidents: number;
  moduleHealth: Record<string, string>;
  liveExecutionBlocked: true;
  createdAt: string;
};
