import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { reliabilityStateStore, type ReliabilityStateStore } from "./reliabilityStateStore";

export type StrategyLease = {
  strategyId: string;
  leaseId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
};

export class StrategyLeaseService {
  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly store: ReliabilityStateStore = reliabilityStateStore,
  ) {}

  acquire(strategyId: string, ownerId: string, ttlMs = 30_000, now = new Date()) {
    const existing = this.store.get<StrategyLease>("strategy_lease", strategyId);
    if (existing && Date.parse(existing.expiresAt) > now.getTime() && existing.ownerId !== ownerId) {
      throw new Error(`Strategy ${strategyId} is leased by another runtime`);
    }
    const lease: StrategyLease = existing?.ownerId === ownerId
      ? { ...existing, expiresAt: new Date(now.getTime() + ttlMs).toISOString() }
      : { strategyId, leaseId: randomUUID(), ownerId, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
    this.store.set("strategy_lease", strategyId, lease);
    this.record("acquired", lease, now);
    return { ...lease };
  }

  renew(strategyId: string, ownerId: string, ttlMs = 30_000, now = new Date()) {
    const existing = this.requireOwned(strategyId, ownerId, now);
    existing.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.store.set("strategy_lease", strategyId, existing);
    this.record("renewed", existing, now);
    return { ...existing };
  }

  release(strategyId: string, ownerId: string, now = new Date()) {
    const existing = this.store.get<StrategyLease>("strategy_lease", strategyId);
    if (!existing) return false;
    if (existing.ownerId !== ownerId) throw new Error(`Strategy ${strategyId} lease is owned by another runtime`);
    this.store.delete("strategy_lease", strategyId);
    this.record("released", existing, now);
    return true;
  }

  isOwned(strategyId: string, ownerId: string, now = new Date()) {
    const lease = this.store.get<StrategyLease>("strategy_lease", strategyId);
    return Boolean(lease && lease.ownerId === ownerId && Date.parse(lease.expiresAt) > now.getTime());
  }

  list(now = new Date()) {
    return this.store.list<StrategyLease>("strategy_lease").map((lease) => ({ ...lease, active: Date.parse(lease.expiresAt) > now.getTime() }));
  }

  private requireOwned(strategyId: string, ownerId: string, now: Date) {
    const existing = this.store.get<StrategyLease>("strategy_lease", strategyId);
    if (!existing || existing.ownerId !== ownerId || Date.parse(existing.expiresAt) <= now.getTime()) {
      throw new Error(`Strategy ${strategyId} does not have an active lease for this runtime`);
    }
    return existing;
  }

  private record(action: "acquired" | "renewed" | "released", lease: StrategyLease, now: Date) {
    this.events.append({
      type: "strategy.lease_changed",
      userId: "system",
      sourceService: "strategy-lease",
      correlationId: lease.leaseId,
      payload: { strategyId: lease.strategyId, ownerId: lease.ownerId, action, expiresAt: lease.expiresAt },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: `strategy.lease.${action}`,
      outcome: "accepted",
      correlationId: lease.leaseId,
      detail: { strategyId: lease.strategyId, ownerId: lease.ownerId, expiresAt: lease.expiresAt },
    });
  }
}

export const strategyLeaseService = new StrategyLeaseService();
