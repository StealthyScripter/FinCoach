import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgOrchestrationRepository } from "./v2/orchestration/pgRepository";

if (!process.env.DATABASE_URL) {
  console.log("v2 orchestration discipline PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repo = new PgOrchestrationRepository(pool);
const suffix = `orchestration-discipline-${Date.now()}-${randomUUID().slice(0, 8)}`;
const correlationId = randomUUID();

try {
  await testAtomicDailyAdmission();
  await testDurableLeaseOwnership();
  console.log("v2 orchestration discipline PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function testAtomicDailyAdmission() {
  const now = new Date("2099-12-31T12:00:00.000Z");
  const [left, right] = await Promise.all([
    repo.admitCycle({ cycle: cycle(`cycle-left-${suffix}`, `left-${suffix}`, now), maxCyclesPerDay: 1, now }),
    repo.admitCycle({ cycle: cycle(`cycle-right-${suffix}`, `right-${suffix}`, now), maxCyclesPerDay: 1, now }),
  ]);
  assert.equal([left, right].filter(result => result.admitted).length, 1);
  assert.equal([left, right].filter(result => result.reason === "daily_limit_reached").length, 1);
}

async function testDurableLeaseOwnership() {
  const leaseName = `lease-${suffix}`;
  const first = await repo.acquireLease({ leaseName, workerId: `worker-a-${suffix}`, now: new Date(), ttlMs: 100, correlationId });
  assert.ok(first);
  assert.equal(await repo.verifyLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date() }), true);
  assert.equal(await repo.acquireLease({ leaseName, workerId: `worker-b-${suffix}`, now: new Date(), ttlMs: 100, correlationId }), null);
  assert.equal(await repo.renewLease({ leaseName, workerId: `worker-b-${suffix}`, fencingToken: first.fencingToken, now: new Date(), ttlMs: 100, correlationId }), null);

  await new Promise(resolve => setTimeout(resolve, 120));
  const second = await repo.acquireLease({ leaseName, workerId: `worker-b-${suffix}`, now: new Date(), ttlMs: 1000, correlationId });
  assert.ok(second);
  assert.ok(second.fencingToken > first.fencingToken);
  assert.equal(await repo.verifyLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date() }), false);
  assert.equal(await repo.releaseLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date() }), false);
  assert.equal(await repo.releaseLease({ leaseName, workerId: second.workerId, fencingToken: second.fencingToken, now: new Date() }), true);
}

function cycle(cycleId: string, requestedBy: string, now: Date) {
  return {
    cycleId,
    status: "requested" as const,
    requestedBy,
    idempotencyKey: `${cycleId}:key`,
    correlationId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function cleanup() {
  const pattern = `%${suffix}%`;
  await pool.query("DELETE FROM v2_orchestration_worker_leases WHERE lease_name LIKE $1 OR worker_id LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_cycles WHERE cycle_id LIKE $1 OR requested_by LIKE $1 OR idempotency_key LIKE $1", [pattern]);
}
