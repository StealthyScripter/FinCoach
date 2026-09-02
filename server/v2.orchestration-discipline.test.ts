import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { InMemoryOrchestrationRepository } from "./v2/orchestration/repository";

await testDailyAdmission();
await testLeaseOwnershipAndFencing();
await testRuntimeAdmissionBeforeLease();
await testRuntimeTimeoutCancelsCycle();
await testRuntimeLeaseLossCancelsCycle();
await testRuntimeBlocksMutationAfterLeaseLoss();
await testStaleCycleRecovery();
testRuntimePersistenceStagesAreGuarded();
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

  const duplicate = repo.admitCycle({ cycle: cycle("cycle-3", "manual", "2026-08-01T00:00:00.000Z"), maxCyclesPerDay: 10, now: new Date("2026-08-01T00:01:00.000Z") });
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
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
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
  const saveGate = deferred<void>();
  const result = await runRuntimeWithBlockedObservation({
    cycleTimeoutMs: 30,
    leaseTtlMs: 200,
    leaseRenewIntervalMs: 50,
    saveGate,
    renewLease: async lease => ({ ...lease, acquiredAt: Date.now(), expiresAt: Date.now() + 200 }),
  });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "cycle_timeout");
  assert.equal(result.saveStarted, true);
  assert.equal(result.saveResolvedBeforeReturn, false, "timeout should cancel the cycle while the blocked write is still pending");
  assert.deepEqual(result.statuses, ["running", "failed"]);
  saveGate.resolve();
  await result.saveSettled;
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
  // The explicit lease_lost terminal reason proves renewal cancellation won the
  // race against the independent cycle-timeout path; wall-clock duration is
  // intentionally not used because this test runs under variable host load.
}

async function testRuntimeBlocksMutationAfterLeaseLoss() {
  const saved = { observations: 0, hypotheses: 0, evaluations: [] as string[] };
  let observationSaved = false;
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
    FINCOACH_V2_CYCLE_TIMEOUT_MS: "500",
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: "200",
    FINCOACH_V2_LEASE_TTL_MS: "1000",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  const lease = { leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 };
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      admitCycle: async ({ cycle, maxCyclesPerDay }: { cycle: unknown; maxCyclesPerDay: number }) => ({ admitted: true, cycle, admittedCount: 1, limit: maxCyclesPerDay, admissionDate: "2026-07-31" }),
      acquireLease: async () => lease,
      renewLease: async () => ({ ...lease, acquiredAt: Date.now(), expiresAt: Date.now() + 1000 }),
      verifyLease: async () => !observationSaved,
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => true,
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: {
      save: async (record: unknown) => {
        saved.observations += 1;
        observationSaved = true;
        return { inserted: true, record };
      },
      eligibleForHypothesis: async () => [],
      eligibleSemanticGroups: async () => [],
    },
    hypotheses: { save: async (record: unknown) => { saved.hypotheses += 1; return { inserted: true, record }; } },
    strategies: { save: async (record: unknown) => ({ inserted: true, record }) },
    experiments: { save: async (record: unknown) => ({ inserted: true, record }) },
    backtests: { save: async (record: unknown) => ({ inserted: true, record }) },
    courtroom: { save: async (record: unknown) => ({ inserted: true, record }) },
    ranking: { save: async (record: unknown) => ({ inserted: true, record }) },
    operations: {
      saveDetectorEvaluation: async (record: { status: string }) => {
        saved.evaluations.push(record.status);
        return { inserted: true, record };
      },
    },
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
  const result = await runtime.runOnce({ requestedBy: "fencing-test" });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "lease_lost");
  assert.equal(saved.observations, 1);
  assert.deepEqual(saved.evaluations, ["attempted"]);
  assert.equal(saved.hypotheses, 0);
}

async function testStaleCycleRecovery() {
  const repo = new InMemoryOrchestrationRepository();
  repo.saveCycle(cycle("stale-1", "manual", "2026-07-31T00:00:00.000Z", "running"));
  repo.saveCycle(cycle("stale-2", "manual", "2026-07-31T00:01:00.000Z", "running"));
  repo.saveCycle(cycle("fresh-running", "manual", "2026-07-31T00:59:00.000Z", "running"));
  repo.saveCycle(cycle("completed", "manual", "2026-07-31T00:00:00.000Z", "completed"));

  const firstBatch = repo.recoverStaleCycles({ now: new Date("2026-07-31T01:00:00.000Z"), staleAfterMs: 30 * 60_000, limit: 1, correlationId: "00000000-0000-4000-8000-000000000099" });
  assert.deepEqual(firstBatch.map(item => item.cycleId), ["stale-1"]);
  assert.equal(firstBatch[0].status, "failed");
  assert.equal(firstBatch[0].payload?.terminalReason, "stale_cycle_recovered");

  const secondBatch = repo.recoverStaleCycles({ now: new Date("2026-07-31T01:00:01.000Z"), staleAfterMs: 30 * 60_000, limit: 10, correlationId: "00000000-0000-4000-8000-000000000099" });
  assert.deepEqual(secondBatch.map(item => item.cycleId), ["stale-2"]);

  const thirdBatch = repo.recoverStaleCycles({ now: new Date("2026-07-31T01:00:02.000Z"), staleAfterMs: 30 * 60_000, limit: 10, correlationId: "00000000-0000-4000-8000-000000000099" });
  assert.deepEqual(thirdBatch, []);

  const guarded = new InMemoryOrchestrationRepository();
  guarded.saveCycle(cycle("active-stale", "manual", "2026-07-31T00:00:00.000Z", "running"));
  const lease = guarded.acquireLease({ leaseName: "fincoach-v2-runtime", workerId: "active-worker", now: new Date("2026-07-31T01:00:00.000Z"), ttlMs: 60_000 });
  assert.ok(lease);
  assert.deepEqual(guarded.recoverStaleCycles({ now: new Date("2026-07-31T01:00:01.000Z"), staleAfterMs: 30 * 60_000, limit: 10, correlationId: "00000000-0000-4000-8000-000000000099" }), []);
}

function testRuntimePersistenceStagesAreGuarded() {
  const source = readFileSync(new URL("./v2/runtime/composition.ts", import.meta.url), "utf8");
  for (const stage of [
    "detector_evaluation_attempted",
    "detector_evaluation_skipped",
    "observation_save",
    "detector_evaluation_duplicate",
    "detector_evaluation_completed",
    "hypothesis_save",
    "strategy_save",
    "experiment_save",
    "backtest_save",
    "courtroom_save",
    "ranking_save",
    "forward_test_save",
    "signal_save",
    "evaluation_save",
    "journal_save",
    "lesson_save",
    "lifecycle_save",
  ]) {
    assert.match(source, new RegExp(`guarded\\(input\\.guard, "${stage}"`), `${stage} must use the guarded mutation boundary`);
  }
  assert.match(source, /guard\.assertOwned\("cycle_completion"\)/);
  assert.match(source, /guard\.assertOwned\("cycle_checkpoint"\)/);
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
  saveDelayMs?: number;
  saveGate?: Deferred<void>;
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
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  const lease = { leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 };
  const statuses: string[] = [];
  let saveStarted = false;
  let saveResolved = false;
  let resolveSaveSettled!: () => void;
  const saveSettled = new Promise<void>(resolve => {
    resolveSaveSettled = resolve;
  });
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      admitCycle: async ({ cycle, maxCyclesPerDay }: { cycle: unknown; maxCyclesPerDay: number }) => ({ admitted: true, cycle, admittedCount: 1, limit: maxCyclesPerDay, admissionDate: "2026-07-31" }),
      acquireLease: async () => lease,
      renewLease: async () => input.renewLease(lease),
      verifyLease: async () => true,
      updateCycleStatus: async (record: { status?: string }) => {
        if (record.status) statuses.push(record.status);
        return record;
      },
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => true,
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: {
      save: async (record: unknown) => {
        saveStarted = true;
        try {
          if (input.saveGate) await input.saveGate.promise;
          else await sleep(input.saveDelayMs ?? 0);
          saveResolved = true;
          return { inserted: true, record };
        } finally {
          resolveSaveSettled();
        }
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
  const keepAlive = input.saveGate ? setInterval(() => undefined, 1_000) : null;
  const started = Date.now();
  try {
    const result = await runtime.runOnce({ requestedBy: "lease-test" });
    const durationMs = Date.now() - started;
    if (!input.saveGate) await sleep((input.saveDelayMs ?? 0) + 10);
    return { ...result, durationMs, saveStarted, saveResolvedBeforeReturn: saveResolved, saveSettled, statuses };
  } finally {
    if (keepAlive) clearInterval(keepAlive);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function cycle(cycleId: string, requestedBy: string, createdAt: string, status: "requested" | "running" | "completed" | "failed" = "requested") {
  return {
    cycleId,
    status,
    requestedBy,
    idempotencyKey: `cycle-key:${cycleId}:${createdAt}`,
    correlationId: "00000000-0000-4000-8000-000000000001",
    createdAt,
    updatedAt: createdAt,
  };
}
