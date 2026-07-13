export type ReliabilityConfig = {
  maxPayloadBytes: number;
  workerQuota: number;
  leaseTtlMs: number;
  retryBudget: number;
  allowedEndpoints: readonly string[];
};

export type DurableLease = {
  leaseName: string;
  workerId: string;
  acquiredAt: number;
  expiresAt: number;
};

export type ReliabilityAuditRecord = {
  auditId: string;
  subjectId: string;
  action: string;
  payloadHash: string;
  previousHash: string | null;
  chainHash: string;
  createdAt: string;
  correlationId: string;
};

export type ReliabilityDeadLetterRecord = {
  sourceEventId: string;
  reason: string;
  replayRequested: boolean;
  createdAt: string;
};

export type ReliabilityHealth = {
  module: "governance";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.reliability.1";
  checkedAt: string;
  activeLeases: number;
  deadLetters: number;
  openCircuitBreakers: number;
  liveExecutionBlocked: true;
};
