import assert from "node:assert/strict";
import { EventLogService } from "./eventLogService";
import { ExecutionAuditLog } from "./execution/riskControls";
import { StrategyLeaseService } from "./execution/strategyLeaseService";

const events = new EventLogService();
const audit = new ExecutionAuditLog();
const leases = new StrategyLeaseService(events, audit);
const start = new Date("2026-06-20T12:00:00.000Z");
const acquired = leases.acquire("strategy-1", "worker-a", 1_000, start);
assert.equal(leases.isOwned("strategy-1", "worker-a", start), true);
assert.throws(() => leases.acquire("strategy-1", "worker-b", 1_000, start), /another runtime/);
const renewed = leases.renew("strategy-1", "worker-a", 2_000, new Date("2026-06-20T12:00:00.500Z"));
assert.ok(Date.parse(renewed.expiresAt) > Date.parse(acquired.expiresAt));
assert.equal(leases.release("strategy-1", "worker-a"), true);
assert.equal(leases.isOwned("strategy-1", "worker-a"), false);
const takeover = leases.acquire("strategy-1", "worker-b", 1_000, new Date("2026-06-20T12:00:02.000Z"));
assert.equal(takeover.ownerId, "worker-b");
assert.equal(events.countByType("strategy.lease_changed"), 4);
assert.ok(audit.list().some((entry) => entry.action === "strategy.lease.released"));

console.log("strategyLeaseService smoke tests passed");
