import type { DomainEvent } from "../contracts";

export type OrchestrationCycleStatus = "requested" | "running" | "completed" | "failed" | "cancelled";
export type ConsumerResultStatus = "completed" | "terminal_rejection";

export type OrchestrationConfig = {
  killSwitchActive: boolean;
  maxQueueDepth: number;
  workerQuota: number;
  leaseTtlMs: number;
  retryBudget: number;
};

export type ResearchCycleRecord = {
  cycleId: string;
  status: OrchestrationCycleStatus;
  requestedBy: string;
  idempotencyKey: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type OrchestrationConsumerInput = {
  event: DomainEvent;
  attempt: number;
  idempotencyKey: string;
};

export type OrchestrationConsumerResult = {
  status: ConsumerResultStatus;
  outputEvents: readonly DomainEvent[];
};

export type OrchestrationConsumer = {
  consumerId: string;
  supportedEvents: readonly string[];
  handler: (input: OrchestrationConsumerInput) => Promise<OrchestrationConsumerResult>;
};

export type OrchestrationCheckpoint = {
  consumerId: string;
  sourceEventId: string;
  idempotencyKey: string;
  checkpointedAt: string;
  attempt: number;
};

export type OrchestrationDeadLetter = {
  deadLetterId: string;
  sourceEventId: string;
  reason: OrchestrationErrorCode;
  createdAt: string;
  retryable: boolean;
  payload: Readonly<Record<string, unknown>>;
};

export type WorkerLease = {
  workerId: string;
  acquiredAt: number;
  expiresAt: number;
};

export type DurableWorkerLease = WorkerLease & {
  leaseName: string;
  fencingToken: number;
};

export type ConsumerAcknowledgement = {
  acknowledgementId: string;
  sourceEventId: string;
  consumerId: string;
  idempotencyKey: string;
  resultHash: string;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
};

export type RetryState = {
  retryId: string;
  sourceEventId: string;
  consumerId: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  exhausted: boolean;
  nextRetryAt: string | null;
  lastErrorCode: OrchestrationErrorCode;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrchestrationErrorCode =
  | "invalid_event"
  | "unsupported_schema"
  | "missing_lineage"
  | "duplicate_event"
  | "stale_event"
  | "consumer_unavailable"
  | "module_unhealthy"
  | "retryable_dependency_failure"
  | "terminal_domain_rejection"
  | "poison_event"
  | "stale_lease"
  | "checkpoint_failure"
  | "persistence_failure"
  | "resource_exhaustion"
  | "kill_switch_block"
  | "configuration_failure"
  | "unknown_failure";

export type OrchestrationRouteResult = {
  result: OrchestrationConsumerResult | null;
  events: DomainEvent[];
};

export type OrchestrationHealth = {
  module: "orchestration";
  status: "healthy" | "degraded" | "unavailable";
  schemaVersion: "fincoach.v2.orchestration.1";
  checkedAt: string;
  cycles: number;
  checkpoints: number;
  deadLetters: number;
  activeWorkerLeases: number;
  queueDepth: number;
  liveExecutionBlocked: true;
};
