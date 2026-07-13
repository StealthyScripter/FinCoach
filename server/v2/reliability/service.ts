import { createHash, randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { DurableLease, ReliabilityAuditRecord, ReliabilityConfig, ReliabilityHealth } from "./contracts";
import { ReliabilityV2EventTypes } from "./events";
import { InMemoryReliabilityRepository } from "./repository";

export class ReliabilityV2Service {
  constructor(private readonly config: ReliabilityConfig, private readonly repository = new InMemoryReliabilityRepository()) {}

  acquireDurableLease(leaseName: string, workerId: string, correlationId: string) {
    const now = Date.now();
    this.repository.expireLeases(now);
    const existing = this.repository.leases.get(leaseName);
    if ((existing && existing.workerId !== workerId) || (this.repository.leases.size >= this.config.workerQuota && !existing)) {
      return { lease: null, events: [this.event(ReliabilityV2EventTypes.DurableLeaseRejected, correlationId, { reason: "lease_contention", leaseName })] };
    }
    const lease: DurableLease = Object.freeze({ leaseName, workerId, acquiredAt: now, expiresAt: now + this.config.leaseTtlMs });
    this.repository.leases.set(leaseName, lease);
    return { lease, events: [this.event(ReliabilityV2EventTypes.DurableLeaseAcquired, correlationId, { leaseName, workerId })] };
  }

  recoverStaleLeases(workerId: string, correlationId: string) {
    const expired = this.repository.expireLeases(Date.now());
    return { events: [this.event(ReliabilityV2EventTypes.StaleLeaseRecovered, correlationId, { workerId, recovered: expired.length })] };
  }

  validatePayload(payload: unknown, correlationId: string) {
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (bytes > this.config.maxPayloadBytes) return { accepted: false, events: [this.event(ReliabilityV2EventTypes.PayloadRejected, correlationId, { reason: "payload_too_large", bytes })] };
    return { accepted: true, events: [] as DomainEvent[] };
  }

  redactSecrets(value: string) {
    return value.replace(/(OANDA_API_TOKEN|TELEGRAM_BOT_TOKEN|DATABASE_URL|token)=?[^ \n]*/gi, "$1=[REDACTED]");
  }

  validateEndpoint(endpoint: string, correlationId: string) {
    if (/api-fxtrade/i.test(endpoint)) return { accepted: false, events: [this.event(ReliabilityV2EventTypes.EndpointRejected, correlationId, { reason: "live_endpoint_blocked" })] };
    const accepted = this.config.allowedEndpoints.some(allowed => endpoint.startsWith(allowed));
    return { accepted, events: accepted ? [] : [this.event(ReliabilityV2EventTypes.EndpointRejected, correlationId, { reason: "endpoint_not_allowlisted" })] };
  }

  recordProviderFailure(providerId: string, reason: string, correlationId: string) {
    const failures = (this.repository.providerFailures.get(providerId) ?? 0) + 1;
    this.repository.providerFailures.set(providerId, failures);
    if (failures >= 3) {
      this.repository.providerBreakers.set(providerId, "open");
      return { events: [this.event(ReliabilityV2EventTypes.ProviderCircuitBreakerOpened, correlationId, { providerId, reason })] };
    }
    return { events: [this.event(ReliabilityV2EventTypes.RetryBudgetRecorded, correlationId, { providerId, failures })] };
  }

  recordProviderSuccess(providerId: string, correlationId: string) {
    this.repository.providerFailures.set(providerId, 0);
    this.repository.providerBreakers.set(providerId, "closed");
    return { events: [this.event(ReliabilityV2EventTypes.ProviderCircuitBreakerClosed, correlationId, { providerId })] };
  }

  providerStatus(providerId: string) {
    return this.repository.providerBreakers.get(providerId) ?? "closed";
  }

  classifyFailure(sourceEventId: string, error: unknown, attempt: number, correlationId: string) {
    const retryable = Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable?: boolean }).retryable);
    const exhausted = retryable && attempt > this.config.retryBudget;
    return { events: [this.event(exhausted ? ReliabilityV2EventTypes.RetryBudgetExhausted : ReliabilityV2EventTypes.RetryBudgetRecorded, correlationId, { sourceEventId, attempt, retryable, terminal: !retryable || exhausted })] };
  }

  appendAudit(input: { subjectId: string; action: string; payloadHash: string; correlationId: string }) {
    const previousHash = this.repository.audit.at(-1)?.chainHash ?? null;
    const record: ReliabilityAuditRecord = Object.freeze({
      auditId: randomUUID(),
      ...input,
      previousHash,
      chainHash: chainHash(previousHash, input.subjectId, input.action, input.payloadHash),
      createdAt: new Date().toISOString(),
    });
    this.repository.audit.push(record);
    return { record, events: [this.event(ReliabilityV2EventTypes.AuditChainAppended, input.correlationId, { auditId: record.auditId })] };
  }

  verifyAuditChain(records: readonly ReliabilityAuditRecord[]) {
    for (const record of records) {
      if (record.chainHash !== chainHash(record.previousHash, record.subjectId, record.action, record.payloadHash)) {
        return { valid: false, events: [this.event(ReliabilityV2EventTypes.AuditChainTamperDetected, record.correlationId, { auditId: record.auditId })] };
      }
    }
    return { valid: true, events: [] as DomainEvent[] };
  }

  createDeadLetter(sourceEventId: string, reason: string, correlationId: string) {
    this.repository.deadLetters.set(sourceEventId, Object.freeze({ sourceEventId, reason, replayRequested: false, createdAt: new Date().toISOString() }));
    return { events: [this.event(ReliabilityV2EventTypes.DeadLetterStored, correlationId, { sourceEventId, reason })] };
  }

  replayDeadLetter(sourceEventId: string, correlationId: string) {
    const existing = this.repository.deadLetters.get(sourceEventId);
    if (existing) this.repository.deadLetters.set(sourceEventId, Object.freeze({ ...existing, replayRequested: true }));
    return { events: [this.event(ReliabilityV2EventTypes.DeadLetterReplayRequested, correlationId, { sourceEventId })] };
  }

  health(checkedAt = new Date().toISOString()): ReliabilityHealth {
    this.repository.expireLeases(Date.now());
    return { module: "governance", status: "healthy", schemaVersion: "fincoach.v2.reliability.1", checkedAt, activeLeases: this.repository.leases.size, deadLetters: this.repository.deadLetters.size, openCircuitBreakers: [...this.repository.providerBreakers.values()].filter(status => status === "open").length, liveExecutionBlocked: true };
  }

  private event(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "governance", correlationId, payload });
  }
}

function chainHash(previousHash: string | null, subjectId: string, action: string, payloadHash: string) {
  return createHash("sha256").update(JSON.stringify({ previousHash, subjectId, action, payloadHash })).digest("hex");
}
