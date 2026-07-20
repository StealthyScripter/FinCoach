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
