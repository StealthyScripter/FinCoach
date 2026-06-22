import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export type ProviderRecoverySnapshot = {
  provider: string;
  operation: string;
  attempts: number;
  recovered: number;
  failures: number;
  lastAttemptAt: string | null;
  lastRecoveredAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
};

export class ProviderRecoveryTelemetry {
  private readonly snapshots = new Map<string, ProviderRecoverySnapshot>();

  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  attempt(provider: string, operation: string, attempt: number, code: string, now = new Date()) {
    const snapshot = this.get(provider, operation);
    snapshot.attempts += 1;
    snapshot.lastAttemptAt = now.toISOString();
    snapshot.lastFailureCode = code;
    this.events.append({
      type: "provider.recovery_attempted",
      userId: "system",
      sourceService: "broker-retry",
      correlationId: `${provider}:${operation}`,
      payload: { provider, operation, attempt, code },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "provider.recovery.attempt",
      outcome: "accepted",
      correlationId: `${provider}:${operation}`,
      detail: { provider, operation, attempt, code },
    });
  }

  recovered(provider: string, operation: string, attempts: number, now = new Date()) {
    const snapshot = this.get(provider, operation);
    snapshot.recovered += 1;
    snapshot.lastRecoveredAt = now.toISOString();
    this.events.append({
      type: "provider.recovery_completed",
      userId: "system",
      sourceService: "broker-retry",
      correlationId: `${provider}:${operation}`,
      payload: { provider, operation, attempts, recovered: true },
      createdAt: now.toISOString(),
    });
  }

  failed(provider: string, operation: string, attempts: number, code: string, now = new Date()) {
    const snapshot = this.get(provider, operation);
    snapshot.failures += 1;
    snapshot.lastFailureAt = now.toISOString();
    snapshot.lastFailureCode = code;
    this.events.append({
      type: "provider.recovery_completed",
      userId: "system",
      sourceService: "broker-retry",
      correlationId: `${provider}:${operation}`,
      payload: { provider, operation, attempts, recovered: false, code },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "provider.recovery.failed",
      outcome: "rejected",
      correlationId: `${provider}:${operation}`,
      detail: { provider, operation, attempts, code },
    });
  }

  list() {
    return Array.from(this.snapshots.values()).map((snapshot) => ({ ...snapshot }));
  }

  private get(provider: string, operation: string) {
    const key = `${provider}:${operation}`;
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    const created: ProviderRecoverySnapshot = {
      provider,
      operation,
      attempts: 0,
      recovered: 0,
      failures: 0,
      lastAttemptAt: null,
      lastRecoveredAt: null,
      lastFailureAt: null,
      lastFailureCode: null,
    };
    this.snapshots.set(key, created);
    return created;
  }
}

export const providerRecoveryTelemetry = new ProviderRecoveryTelemetry();
