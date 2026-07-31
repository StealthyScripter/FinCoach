import assert from "node:assert/strict";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { InMemoryOrchestrationRepository } from "./v2/orchestration/repository";

await testDailyAdmission();
await testLeaseOwnershipAndFencing();
await testRuntimeAdmissionBeforeLease();
await testRuntimeTimeoutCancelsCycle();
await testRuntimeLeaseLossCancelsCycle();
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

async function testRuntimeTimeoutCancelsCycle() {
  const result = await runRuntimeWithBlockedObservation({
    cycleTimeoutMs: 30,
    leaseTtlMs: 200,
    leaseRenewIntervalMs: 50,
    saveDelayMs: 120,
    renewLease: async lease => ({ ...lease, acquiredAt: Date.now(), expiresAt: Date.now() + 200 }),
  });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "cycle_timeout");
  assert.ok(result.durationMs < 110, `timeout should cancel promptly, got ${result.durationMs}ms`);
}

async function testRuntimeLeaseLossCancelsCycle() {
  let renewCalls = 0;
  const result = await runRuntimeWithBlockedObservation({
    cycleTimeoutMs: 500,
    leaseTtlMs: 120,
    leaseRenewIntervalMs: 20,
    saveDelayMs: 160,
    renewLease: async () => {
      renewCalls += 1;
      return null;
    },
  });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "lease_lost");
  assert.ok(renewCalls >= 1);
  assert.ok(result.durationMs < 140, `lease loss should cancel promptly, got ${result.durationMs}ms`);
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

async function runRuntimeWithBlockedObservation(input: {
  cycleTimeoutMs: number;
  leaseTtlMs: number;
  leaseRenewIntervalMs: number;
  saveDelayMs: number;
  renewLease: (lease: { leaseName: string; workerId: string; fencingToken: number }) => Promise<unknown>;
}) {
  const runtime = createFinCoachV2Runtime({
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "false",
    FINCOACH_V2_SYMBOLS: "EUR_USD",
    FINCOACH_V2_TIMEFRAMES: "M15",
    FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "1",
    FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE: "1",
    FINCOACH_V2_CYCLE_TIMEOUT_MS: String(input.cycleTimeoutMs),
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: String(input.leaseRenewIntervalMs),
    FINCOACH_V2_LEASE_TTL_MS: String(input.leaseTtlMs),
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
  } as NodeJS.ProcessEnv);
  const lease = { leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 };
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      admitCycle: async ({ cycle, maxCyclesPerDay }: { cycle: unknown; maxCyclesPerDay: number }) => ({ admitted: true, cycle, admittedCount: 1, limit: maxCyclesPerDay, admissionDate: "2026-07-31" }),
      acquireLease: async () => lease,
      renewLease: async () => input.renewLease(lease),
      verifyLease: async () => true,
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => true,
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: {
      save: async (record: unknown) => {
        await sleep(input.saveDelayMs);
        return { inserted: true, record };
      },
      eligibleForHypothesis: async () => [],
      eligibleSemanticGroups: async () => [],
    },
    hypotheses: { save: async (record: unknown) => ({ inserted: true, record }) },
    strategies: { save: async (record: unknown) => ({ inserted: true, record }) },
    experiments: { save: async (record: unknown) => ({ inserted: true, record }) },
    backtests: { save: async (record: unknown) => ({ inserted: true, record }) },
    courtroom: { save: async (record: unknown) => ({ inserted: true, record }) },
    ranking: { save: async (record: unknown) => ({ inserted: true, record }) },
    operations: {},
    pilot: {},
    forwardTesting: {},
    signals: {},
    evaluations: {},
    journal: {},
    learning: {},
    lifecycle: {},
    evolution: {},
    evidence: {},
  };
  const started = Date.now();
  const result = await runtime.runOnce({ requestedBy: "lease-test" });
  const durationMs = Date.now() - started;
  await sleep(input.saveDelayMs + 10);
  return { ...result, durationMs };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
