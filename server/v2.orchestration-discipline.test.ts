import assert from "node:assert/strict";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { InMemoryOrchestrationRepository } from "./v2/orchestration/repository";

await testDailyAdmission();
await testLeaseOwnershipAndFencing();
await testRuntimeAdmissionBeforeLease();
await testConfigAlignment();

console.log("v2 orchestration discipline tests passed");

async function testDailyAdmission() {
  const repo = new InMemoryOrchestrationRepository();
  const first = repo.admitCycle({ cycle: cycle("cycle-1", "manual", "2026-07-31T00:00:00.000Z"), maxCyclesPerDay: 1, now: new Date("2026-07-31T10:00:00.000Z") });
  assert.equal(first.admitted, true);
  assert.equal(first.admittedCount, 1);

  const blocked = repo.admitCycle({ cycle: cycle("cycle-2", "manual-2", "2026-07-31T01:00:00.000Z"), maxCyclesPerDay: 1, now: new Date("2026-07-31T12:00:00.000Z") });
  assert.equal(blocked.admitted, false);
  assert.equal(blocked.reason, "daily_limit_reached");

  const zero = new InMemoryOrchestrationRepository().admitCycle({ cycle: cycle("cycle-zero", "manual", "2026-07-31T00:00:00.000Z"), maxCyclesPerDay: 0, now: new Date("2026-07-31T12:00:00.000Z") });
  assert.equal(zero.admitted, false);
  assert.equal(zero.reason, "daily_limit_reached");

  const nextDay = repo.admitCycle({ cycle: cycle("cycle-3", "manual", "2026-08-01T00:00:00.000Z"), maxCyclesPerDay: 1, now: new Date("2026-08-01T00:00:00.000Z") });
  assert.equal(nextDay.admitted, true);

  const duplicate = repo.admitCycle({ cycle: cycle("cycle-duplicate", "manual", "2026-08-01T00:00:00.000Z"), maxCyclesPerDay: 10, now: new Date("2026-08-01T00:01:00.000Z") });
  assert.equal(duplicate.admitted, false);
  assert.equal(duplicate.reason, "duplicate_cycle_window_suppressed");
}

async function testLeaseOwnershipAndFencing() {
  const repo = new InMemoryOrchestrationRepository();
  const now = new Date("2026-07-31T12:00:00.000Z");
  const first = repo.acquireLease({ leaseName: "fincoach-v2-runtime", workerId: "worker-a", now, ttlMs: 100 });
  assert.ok(first);
  assert.equal(repo.verifyLease({ leaseName: first.leaseName, workerId: "worker-a", fencingToken: first.fencingToken, now: new Date("2026-07-31T12:00:00.050Z") }), true);

  const blocked = repo.acquireLease({ leaseName: "fincoach-v2-runtime", workerId: "worker-b", now: new Date("2026-07-31T12:00:00.050Z"), ttlMs: 100 });
  assert.equal(blocked, null);

  const renewed = repo.renewLease({ leaseName: first.leaseName, workerId: "worker-a", fencingToken: first.fencingToken, now: new Date("2026-07-31T12:00:00.060Z"), ttlMs: 100 });
  assert.ok(renewed);
  assert.equal(repo.renewLease({ leaseName: first.leaseName, workerId: "worker-b", fencingToken: first.fencingToken, now: new Date("2026-07-31T12:00:00.070Z"), ttlMs: 100 }), null);
  assert.equal(repo.renewLease({ leaseName: first.leaseName, workerId: "worker-a", fencingToken: first.fencingToken + 1, now: new Date("2026-07-31T12:00:00.070Z"), ttlMs: 100 }), null);

  const second = repo.acquireLease({ leaseName: "fincoach-v2-runtime", workerId: "worker-b", now: new Date("2026-07-31T12:00:00.200Z"), ttlMs: 100 });
  assert.ok(second);
  assert.ok(second.fencingToken > first.fencingToken);
  assert.equal(repo.verifyLease({ leaseName: first.leaseName, workerId: "worker-a", fencingToken: first.fencingToken, now: new Date("2026-07-31T12:00:00.201Z") }), false);
  assert.equal(repo.releaseLease({ leaseName: first.leaseName, workerId: "worker-a", fencingToken: first.fencingToken }), false);
  assert.equal(repo.releaseLease({ leaseName: second.leaseName, workerId: "worker-b", fencingToken: second.fencingToken }), true);
}

async function testRuntimeAdmissionBeforeLease() {
  const runtime = createFinCoachV2Runtime({
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_MAX_CYCLES_PER_DAY: "0",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
  } as NodeJS.ProcessEnv);
  let leaseAttempts = 0;
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      admitCycle: async () => ({ admitted: false, reason: "daily_limit_reached", admittedCount: 0, limit: 0, admissionDate: "2026-07-31" }),
      acquireLease: async () => { leaseAttempts += 1; return null; },
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
  };
  const result = await runtime.runOnce({ requestedBy: "manual-test" });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "daily_limit_reached");
  assert.equal(leaseAttempts, 0);
}

function testConfigAlignment() {
  const invalid = loadV2RuntimeConfig({
    FINCOACH_V2_LEASE_TTL_MS: "1000",
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: "1000",
  } as NodeJS.ProcessEnv);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /LEASE_RENEW_INTERVAL/);

  const valid = loadV2RuntimeConfig({
    FINCOACH_V2_LEASE_TTL_MS: "60000",
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: "20000",
  } as NodeJS.ProcessEnv);
  assert.equal(valid.ok, true);
  assert.equal(valid.config.leaseRenewIntervalMs, 20000);
}

function cycle(cycleId: string, requestedBy: string, createdAt: string) {
  return {
    cycleId,
    status: "requested" as const,
    requestedBy,
    idempotencyKey: `cycle-key:${createdAt}`,
    correlationId: "00000000-0000-4000-8000-000000000001",
    createdAt,
    updatedAt: createdAt,
  };
}
