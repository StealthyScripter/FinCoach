import type { OrchestrationCheckpoint, OrchestrationDeadLetter, ResearchCycleRecord, WorkerLease } from "./contracts";

export class InMemoryOrchestrationRepository {
  private readonly cycles = new Map<string, ResearchCycleRecord>();
  private readonly processed = new Set<string>();
  private readonly checkpoints = new Map<string, OrchestrationCheckpoint>();
  private readonly deadLetterRecords = new Map<string, OrchestrationDeadLetter>();
  private readonly workerLeases = new Map<string, WorkerLease>();

  saveCycle(cycle: ResearchCycleRecord) {
    const existing = this.cycles.get(cycle.idempotencyKey);
    if (existing) return { inserted: false, cycle: existing };
    const frozen = freezeRecord(cycle);
    this.cycles.set(cycle.idempotencyKey, frozen);
    return { inserted: true, cycle: frozen };
  }

  markProcessed(idempotencyKey: string) {
    if (this.processed.has(idempotencyKey)) return false;
    this.processed.add(idempotencyKey);
    return true;
  }

  checkpoint(record: OrchestrationCheckpoint) {
    const frozen = freezeRecord(record);
    this.checkpoints.set(record.consumerId, frozen);
    return frozen;
  }

  checkpointFor(consumerId: string) {
    return this.checkpoints.get(consumerId) ?? null;
  }

  addDeadLetter(record: OrchestrationDeadLetter) {
    const frozen = freezeRecord(record);
    this.deadLetterRecords.set(record.deadLetterId, frozen);
    return frozen;
  }

  deadLetters() {
    return [...this.deadLetterRecords.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.deadLetterId.localeCompare(b.deadLetterId));
  }

  acquireLease(workerId: string, now: number, ttlMs: number, quota: number) {
    this.expireLeases(now);
    if (this.workerLeases.size >= quota && !this.workerLeases.has(workerId)) return null;
    const lease = freezeRecord({ workerId, acquiredAt: now, expiresAt: now + ttlMs });
    this.workerLeases.set(workerId, lease);
    return lease;
  }

  recoverStaleLeases(workerId: string, now: number, ttlMs: number) {
    const expired = this.expireLeases(now);
    const lease = freezeRecord({ workerId, acquiredAt: now, expiresAt: now + ttlMs });
    this.workerLeases.set(workerId, lease);
    return { expired, lease };
  }

  activeLeases(now: number) {
    this.expireLeases(now);
    return [...this.workerLeases.values()];
  }

  stats(now: number) {
    return {
      cycles: this.cycles.size,
      checkpoints: this.checkpoints.size,
      deadLetters: this.deadLetterRecords.size,
      activeWorkerLeases: this.activeLeases(now).length,
    };
  }

  private expireLeases(now: number) {
    const expired: WorkerLease[] = [];
    for (const [workerId, lease] of this.workerLeases) {
      if (lease.expiresAt <= now) {
        expired.push(lease);
        this.workerLeases.delete(workerId);
      }
    }
    return expired;
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
