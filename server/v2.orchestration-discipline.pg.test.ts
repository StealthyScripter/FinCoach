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
  await testUtcDailyAdmissionAcrossRepositoryInstances();
  await testConcurrentLeaseAcquisition();
  await testDurableLeaseOwnership();
  await testLeaseRenewalPreservesFencingToken();
  await testLeaseTakeoverFencesOldOwner();
  await testConcurrentStaleRecovery();
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

async function testUtcDailyAdmissionAcrossRepositoryInstances() {
  const poolB = new Pool({ connectionString: process.env.DATABASE_URL });
  const repoB = new PgOrchestrationRepository(poolB);
  try {
    const lateUtc = new Date("2099-11-30T23:59:59.000Z");
    const nextUtc = new Date("2099-12-01T00:00:00.000Z");
    const late = await repo.admitCycle({ cycle: cycle(`cycle-late-${suffix}`, `late-${suffix}`, lateUtc), maxCyclesPerDay: 1, now: lateUtc });
    const firstNext = await repoB.admitCycle({ cycle: cycle(`cycle-next-${suffix}`, `next-${suffix}`, nextUtc), maxCyclesPerDay: 1, now: nextUtc });
    const blockedNext = await repoB.admitCycle({ cycle: cycle(`cycle-next-blocked-${suffix}`, `next-blocked-${suffix}`, nextUtc), maxCyclesPerDay: 1, now: nextUtc });
    assert.equal(late.admitted, true);
    assert.equal(firstNext.admitted, true);
    assert.equal(blockedNext.admitted, false);
    assert.equal(blockedNext.reason, "daily_limit_reached");
  } finally {
    await poolB.end();
  }
}

async function testConcurrentLeaseAcquisition() {
  const leaseName = `lease-concurrent-${suffix}`;
  const [left, right] = await Promise.all([
    repo.acquireLease({ leaseName, workerId: `worker-left-${suffix}`, now: new Date(), ttlMs: 1000, correlationId }),
    repo.acquireLease({ leaseName, workerId: `worker-right-${suffix}`, now: new Date(), ttlMs: 1000, correlationId }),
  ]);
  assert.equal([left, right].filter(Boolean).length, 1);
  const owner = left ?? right;
  assert.ok(owner);
  assert.equal(await repo.releaseLease({ leaseName, workerId: owner.workerId, fencingToken: owner.fencingToken, now: new Date() }), true);
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

async function testLeaseRenewalPreservesFencingToken() {
  const leaseName = `lease-renew-${suffix}`;
  const first = await repo.acquireLease({ leaseName, workerId: `worker-renew-${suffix}`, now: new Date(), ttlMs: 250, correlationId });
  assert.ok(first);
  await new Promise(resolve => setTimeout(resolve, 25));
  const renewed = await repo.renewLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date(), ttlMs: 1000, correlationId });
  assert.ok(renewed);
  assert.equal(renewed.fencingToken, first.fencingToken);
  assert.ok(renewed.expiresAt > first.expiresAt);
  assert.equal(await repo.releaseLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date() }), true);
}

async function testLeaseTakeoverFencesOldOwner() {
  const now = new Date("2099-10-01T12:00:00.000Z");
  const admitted = await repo.admitCycle({ cycle: cycle(`cycle-fenced-${suffix}`, `fenced-${suffix}`, now), maxCyclesPerDay: 10, now });
  assert.equal(admitted.admitted, true);
  assert.ok(admitted.cycle);
  const leaseName = `lease-fenced-${suffix}`;
  const first = await repo.acquireLease({ leaseName, workerId: `worker-old-${suffix}`, now: new Date(), ttlMs: 100, correlationId });
  assert.ok(first);
  await repo.updateCycleStatus({ cycleId: admitted.cycle.cycleId, status: "running", lease: first });
  await new Promise(resolve => setTimeout(resolve, 120));
  const second = await repo.acquireLease({ leaseName, workerId: `worker-new-${suffix}`, now: new Date(), ttlMs: 1000, correlationId });
  assert.ok(second);
  await assert.rejects(
    () => repo.updateCycleStatus({ cycleId: admitted.cycle!.cycleId, status: "completed", lease: first }),
    /lease fencing|optimistic_concurrency_conflict/,
  );
  assert.equal(await repo.releaseLease({ leaseName, workerId: first.workerId, fencingToken: first.fencingToken, now: new Date() }), false);
  const completed = await repo.updateCycleStatus({ cycleId: admitted.cycle.cycleId, status: "completed", lease: second });
  assert.equal(completed.status, "completed");
  assert.equal(await repo.releaseLease({ leaseName, workerId: second.workerId, fencingToken: second.fencingToken, now: new Date() }), true);
}

async function testConcurrentStaleRecovery() {
  const now = new Date("2099-09-01T12:00:00.000Z");
  const admitted = await repo.admitCycle({ cycle: { ...cycle(`cycle-stale-${suffix}`, `stale-${suffix}`, now), status: "running", updatedAt: "2099-09-01T10:00:00.000Z" }, maxCyclesPerDay: 10, now });
  assert.equal(admitted.admitted, true);
  const recovered = await Promise.all([
    repo.recoverStaleCycles({ now, staleAfterMs: 60 * 60_000, limit: 10, correlationId }),
    repo.recoverStaleCycles({ now, staleAfterMs: 60 * 60_000, limit: 10, correlationId }),
  ]);
  const flattened = recovered.flat();
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].cycleId, `cycle-stale-${suffix}`);
  assert.equal(flattened[0].status, "failed");
  assert.equal(flattened[0].payload?.terminalReason, "stale_cycle_recovered");
  const repeated = await repo.recoverStaleCycles({ now: new Date("2099-09-01T12:01:00.000Z"), staleAfterMs: 60 * 60_000, limit: 10, correlationId });
  assert.deepEqual(repeated, []);
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
