import type { CycleAdmissionResult, DurableWorkerLease, OrchestrationCheckpoint, OrchestrationDeadLetter, ResearchCycleRecord } from "./contracts";

export class InMemoryOrchestrationRepository {
  private readonly cycles = new Map<string, ResearchCycleRecord>();
  private readonly processed = new Set<string>();
  private readonly checkpoints = new Map<string, OrchestrationCheckpoint>();
  private readonly deadLetterRecords = new Map<string, OrchestrationDeadLetter>();
  private readonly workerLeases = new Map<string, DurableWorkerLease>();
  private fencingSequence = 0;

  saveCycle(cycle: ResearchCycleRecord) {
    const existing = this.cycles.get(cycle.idempotencyKey);
    if (existing) return { inserted: false, cycle: existing };
    const frozen = freezeRecord(cycle);
    this.cycles.set(cycle.idempotencyKey, frozen);
    return { inserted: true, cycle: frozen };
  }

  admitCycle(input: { cycle: ResearchCycleRecord; maxCyclesPerDay: number; now: Date; admissionTimezone?: "UTC" }): CycleAdmissionResult {
    const admissionDate = input.now.toISOString().slice(0, 10);
    const limit = Math.max(0, input.maxCyclesPerDay);
    if (limit <= 0) return { admitted: false, reason: "daily_limit_reached", admittedCount: 0, limit, admissionDate };
    const existing = this.cycles.get(input.cycle.idempotencyKey);
    if (existing) return { admitted: false, reason: "duplicate_cycle_window_suppressed", cycle: existing, admittedCount: 0, limit, admissionDate };
    const admittedCount = [...this.cycles.values()].filter(cycle => cycle.createdAt.slice(0, 10) === admissionDate).length;
    if (admittedCount >= limit) return { admitted: false, reason: "daily_limit_reached", admittedCount, limit, admissionDate };
    const cycle = freezeRecord({ ...input.cycle, payload: { ...(input.cycle.payload ?? {}), admissionDate, admittedAt: input.now.toISOString() } });
    this.cycles.set(cycle.idempotencyKey, cycle);
    return { admitted: true, cycle, admittedCount: admittedCount + 1, limit, admissionDate };
  }

  updateCycleStatus(input: { cycleId: string; status: ResearchCycleRecord["status"]; now?: string; reason?: string; lease?: { leaseName: string; workerId: string; fencingToken: number } }) {
    if (input.lease && !this.verifyLease({ ...input.lease, now: new Date(input.now ?? new Date().toISOString()) })) {
      throw new Error("Research cycle status update failed lease fencing");
    }
    const current = [...this.cycles.values()].find(cycle => cycle.cycleId === input.cycleId);
    if (!current) throw new Error("Research cycle not found for status update");
    const updated = freezeRecord({ ...current, status: input.status, updatedAt: input.now ?? new Date().toISOString(), payload: { ...(current.payload ?? {}), ...(input.reason ? { terminalReason: input.reason } : {}) } });
    this.cycles.set(updated.idempotencyKey, updated);
    return updated;
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

  acquireLease(workerIdOrInput: string | { leaseName: string; workerId: string; now: Date; ttlMs: number }, nowInput?: number, ttlMsInput?: number, quotaInput?: number): DurableWorkerLease | null {
    const leaseName = typeof workerIdOrInput === "string" ? workerIdOrInput : workerIdOrInput.leaseName;
    const workerId = typeof workerIdOrInput === "string" ? workerIdOrInput : workerIdOrInput.workerId;
    const now = typeof workerIdOrInput === "string" ? nowInput ?? Date.now() : workerIdOrInput.now.getTime();
    const ttlMs = typeof workerIdOrInput === "string" ? ttlMsInput ?? 30_000 : workerIdOrInput.ttlMs;
    const quota = typeof workerIdOrInput === "string" ? quotaInput ?? 1 : 1;
    this.expireLeases(now);
    const existing = this.workerLeases.get(leaseName);
    if (existing && existing.workerId !== workerId) return null;
    if (this.workerLeases.size >= quota && !existing) return null;
    const lease = freezeRecord({ leaseName, workerId, fencingToken: existing?.fencingToken ?? ++this.fencingSequence, acquiredAt: now, expiresAt: now + ttlMs });
    this.workerLeases.set(leaseName, lease);
    return lease;
  }

  recoverStaleLeases(workerId: string, now: number, ttlMs: number) {
    const expired = this.expireLeases(now);
    const lease = freezeRecord({ leaseName: workerId, workerId, fencingToken: ++this.fencingSequence, acquiredAt: now, expiresAt: now + ttlMs });
    this.workerLeases.set(workerId, lease);
    return { expired, lease };
  }

  renewLease(input: { leaseName: string; workerId: string; fencingToken: number; now: Date; ttlMs: number }) {
    const now = input.now.getTime();
    const lease = this.workerLeases.get(input.leaseName);
    if (!lease || lease.workerId !== input.workerId || lease.fencingToken !== input.fencingToken || lease.expiresAt <= now) return null;
    const renewed = freezeRecord({ ...lease, expiresAt: now + input.ttlMs });
    this.workerLeases.set(input.leaseName, renewed);
    return renewed;
  }

  verifyLease(input: { leaseName: string; workerId: string; fencingToken: number; now: Date }) {
    const lease = this.workerLeases.get(input.leaseName);
    return Boolean(lease && lease.workerId === input.workerId && lease.fencingToken === input.fencingToken && lease.expiresAt > input.now.getTime());
  }

  releaseLease(input: { leaseName: string; workerId: string; fencingToken: number }) {
    const lease = this.workerLeases.get(input.leaseName);
    if (!lease || lease.workerId !== input.workerId || lease.fencingToken !== input.fencingToken) return false;
    this.workerLeases.delete(input.leaseName);
    return true;
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
    const expired: DurableWorkerLease[] = [];
    for (const [leaseName, lease] of this.workerLeases) {
      if (lease.expiresAt <= now) {
        expired.push(lease);
        this.workerLeases.delete(leaseName);
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
