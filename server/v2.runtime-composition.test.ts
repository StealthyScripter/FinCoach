import assert from "assert/strict";
import { buildObservationPlan, createFinCoachV2Runtime, createForwardTestsFromRanking, planProviderRequests, sanitizedProviderFailureReason } from "./v2/runtime/composition";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { StrategyResearchSchedulerService } from "./strategyResearchSchedulerService";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { TelegramReportingService } from "./telegram/reportingService";
import { InMemoryTelegramRepository } from "./telegram/repository";

const disabledEnv = {
  FINCOACH_V2_RUNTIME_ENABLED: "false",
  FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_TELEGRAM_TRANSPORT: "disabled",
} as NodeJS.ProcessEnv;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

{
  const validation = loadV2RuntimeConfig(disabledEnv);
  assert.equal(validation.ok, true);
  assert.equal(validation.config.runtimeEnabled, false);
  assert.equal(validation.config.liveExecutionEnabled, false);
  assert.equal(validation.config.telegramTransport, "disabled");
  assert.equal(validation.config.maxCyclesPerDay, 8);
  assert.equal(validation.config.cycleTimeoutMs, 120000);
  assert.equal(validation.config.leaseTtlMs, 60000);
  assert.equal(validation.config.leaseRenewIntervalMs, 20000);
}

{
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA historical candles failed with HTTP 401")), "provider_http_401");
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA historical candles failed with HTTP 403")), "provider_http_403");
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA historical candles failed with HTTP 429")), "provider_http_429");
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA historical candles failed with HTTP 502")), "provider_http_5xx");
  assert.equal(sanitizedProviderFailureReason(new Error("This operation was aborted")), "provider_timeout");
  assert.equal(sanitizedProviderFailureReason(new Error("fetch failed ECONNRESET")), "provider_network");
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA returned insufficient completed candles")), "insufficient_completed_candles");
  assert.equal(sanitizedProviderFailureReason(new Error("OANDA candle missing mid prices")), "invalid_candles");
}

{
  const config = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_V2_RESEARCH_DATA_MODE: "provider",
    FINCOACH_V2_SYMBOLS: "EUR_USD,GBP_USD",
    FINCOACH_V2_TIMEFRAMES: "1m",
    FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR: "4",
    FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "4",
    FINCOACH_V2_PROVIDER_CALL_BUDGET: "1",
  }).config;
  const plans = buildObservationPlan(config, config.symbols, "cycle-budget-test");
  const requests = planProviderRequests(config, plans);
  assert.equal(plans.length, 4);
  assert.equal(requests.plannedProviderRequests, 2);
  assert.equal(requests.selected.length, 1);
  assert.equal(requests.deferred.length, 1);
  assert.equal(requests.selected[0].plans.length, 2, "one provider request should feed both compatible 1m detectors");
  assert.equal(requests.deferred[0].plans.length, 2);
  const seenFirstRequests = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    const rotated = planProviderRequests(config, buildObservationPlan(config, config.symbols, `cycle-${index}`));
    seenFirstRequests.add(`${rotated.selected[0].symbol}:${rotated.selected[0].timeframe}`);
  }
  assert.ok(seenFirstRequests.size > 1, "deterministic rotation should not permanently starve later symbols");
  assert.deepEqual(
    planProviderRequests(config, buildObservationPlan(config, config.symbols, "restart-key")),
    planProviderRequests(config, buildObservationPlan(config, config.symbols, "restart-key")),
  );
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_LIVE_EXECUTION_ENABLED: "true",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /LIVE_EXECUTION/);
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_RESEARCH_DATA_MODE: "provider",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /OANDA_API_TOKEN/);
  assert.match(validation.errors.join("\n"), /OANDA_ACCOUNT_ID/);
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_RESEARCH_DATA_MODE: "provider",
    OANDA_ENV: "live",
    OANDA_API_TOKEN: "test-token",
    OANDA_ACCOUNT_ID: "test-account",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /OANDA_ENV=practice/);
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_V2_RESEARCH_ENABLED: "false",
    FINCOACH_V2_RESEARCH_DATA_MODE: "provider",
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.config.researchEnabled, false);
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_TELEGRAM_TRANSPORT: "long_polling",
    TELEGRAM_WEBHOOK_URL: "",
    TELEGRAM_WEBHOOK_SECRET: "",
    TELEGRAM_WEBHOOK_ENABLED: "false",
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.config.telegramTransport, "long_polling");
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_TELEGRAM_TRANSPORT: "long_polling",
    TELEGRAM_WEBHOOK_ENABLED: "true",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /Long polling and webhook/);
}

{
  const validation = loadV2RuntimeConfig({
    ...disabledEnv,
    FINCOACH_V2_MAX_CYCLES_PER_DAY: "not-a-number",
    FINCOACH_V2_CYCLE_TIMEOUT_MS: "-1",
    FINCOACH_V2_LEASE_TTL_MS: "NaN",
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: "-50",
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.config.maxCyclesPerDay, 8);
  assert.equal(validation.config.cycleTimeoutMs, 120000);
  assert.equal(validation.config.leaseTtlMs, 60000);
  assert.equal(validation.config.leaseRenewIntervalMs, 20000);
}

{
  const runtime = createFinCoachV2Runtime(disabledEnv);
  await runtime.initialize();
  const status = runtime.status();
  assert.equal(status.state, "disabled");
  assert.equal(status.liveExecutionBlocked, true);
  assert.equal(status.liveMoneyExecution, "blocked");
  assert.equal(status.paperExecution, "disabled");
  assert.equal(status.demoBrokerExecution, "disabled");
  assert.equal(status.telegramPublication, "disabled");
  assert.deepEqual(status.orchestrationSafety, {
    schemaVersion: "fincoach.v2.orchestration-safety.1",
    admissionTimezone: "UTC",
    maxCyclesPerUtcDay: 8,
    cycleTimeoutMs: 120000,
    leaseTtlMs: 60000,
    leaseRenewIntervalMs: 20000,
    liveExecutionBlocked: true,
    blockers: [],
  });
  assert.doesNotMatch(JSON.stringify(status), /test-worker|postgres:\/\/user:pass|DATABASE_URL/);
}

{
  const runtime = createFinCoachV2Runtime({
    ...disabledEnv,
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_LIVE_EXECUTION_ENABLED: "true",
  });
  await assert.rejects(() => runtime.initialize(), /V2 runtime configuration failed/);
  const status = runtime.status();
  assert.equal(status.liveExecutionBlocked, true);
  assert.deepEqual((status.orchestrationSafety as { blockers: string[] }).blockers, ["invalid_orchestration_configuration"]);
  assert.doesNotMatch(JSON.stringify(status), /postgres:\/\/|DATABASE_URL=|test-worker/);
}

{
  const saved = {
    observations: [] as Array<{ causationId: string | null; upstreamEventIds: string[] }>,
    hypotheses: [] as Array<{ causationId: string | null }>,
    strategies: [] as Array<{ causationId: string | null }>,
    experiments: [] as Array<{ causationId: string | null }>,
    backtests: [] as Array<{ causationId: string | null; lineageEventIds: string[] }>,
    court: [] as Array<{ causationId: string | null; lineageEventIds: string[] }>,
    rankings: [] as Array<{ causationId: string | null; lineageEventIds: string[] }>,
  };
  const save = <T>(collection: T[]) => async (record: T) => {
    collection.push(record);
    return { inserted: true, record };
  };
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
    FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE: "1",
    FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE: "1",
    FINCOACH_V2_LEASE_RENEW_INTERVAL_MS: "20",
    FINCOACH_V2_LEASE_TTL_MS: "100",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  const lease = { leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 };
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      admitCycle: async ({ cycle, maxCyclesPerDay }: { cycle: unknown; maxCyclesPerDay: number }) => ({ admitted: true, cycle, admittedCount: 1, limit: maxCyclesPerDay, admissionDate: "2026-07-31" }),
      acquireLease: async () => lease,
      renewLease: async () => ({ ...lease, acquiredAt: Date.now(), expiresAt: Date.now() + 100 }),
      verifyLease: async () => true,
      saveCycle: async (record: unknown) => ({ inserted: true, record }),
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => true,
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: { save: save(saved.observations), eligibleForHypothesis: async () => [], eligibleSemanticGroups: async () => [] },
    hypotheses: { save: save(saved.hypotheses) },
    strategies: { save: save(saved.strategies) },
    experiments: { save: save(saved.experiments) },
    backtests: { save: save(saved.backtests) },
    courtroom: { save: save(saved.court) },
    ranking: { save: save(saved.rankings) },
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
  const result = await runtime.runOnce({ requestedBy: "test" });
  assert.equal(result.completed, true);
  assert.equal(saved.observations.length, 1);
  const observation = saved.observations[0];
  assert.match(observation.causationId!, uuidPattern);
  assert.match(observation.upstreamEventIds[0], uuidPattern);
  assert.doesNotMatch(observation.causationId!, /^cycle-/);
}

{
  const originalFetch = globalThis.fetch;
  const saved = { evaluations: [] as Array<{ status: string; reason?: string | null; symbol: string; timeframe: string; detectorId: string }> };
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({ candles: oandaCandles("2026-07-31T14:00:00.000Z", 80, "M1") }),
    } as Response;
  }) as typeof fetch;
  try {
    const runtime = createFinCoachV2Runtime(providerRuntimeEnv({
      FINCOACH_V2_SYMBOLS: "EUR_USD,GBP_USD",
      FINCOACH_V2_TIMEFRAMES: "1m",
      FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR: "4",
      FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "4",
      FINCOACH_V2_PROVIDER_CALL_BUDGET: "1",
    }));
    (runtime as unknown as { repositories: unknown }).repositories = runtimeRepositories({
      saveDetectorEvaluation: async (record) => {
        saved.evaluations.push(record);
      },
      observationSave: async (record) => ({ inserted: true, record }),
    });
    const result = await runtime.runOnce({ requestedBy: "provider-budget-test" });
    assert.equal(result.completed, true);
    assert.equal(fetchCalls, 1, "one provider request should be reused across compatible detectors");
    assert.equal(saved.evaluations.filter(item => item.status === "attempted").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "completed").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "skipped" && item.reason === "provider_budget").length, 2);
    assert.equal(((result.planning as Record<string, Record<string, unknown>>).resourceControl).plannedProviderRequests, 2);
    assert.equal(((result.planning as Record<string, Record<string, unknown>>).resourceControl).executedProviderRequests, 1);
    assert.equal(((result.planning as Record<string, Record<string, unknown>>).resourceControl).providerRequestsDeferredByBudget, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const saved = { evaluations: [] as Array<{ status: string; reason?: string | null; symbol: string; timeframe: string; detectorId: string }>, observations: [] as unknown[] };
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    const candles = oandaCandles("2026-07-31T14:00:00.000Z", 81, "M1");
    candles[candles.length - 1].complete = false;
    return {
      ok: true,
      json: async () => ({ candles }),
    } as Response;
  }) as typeof fetch;
  try {
    const runtime = createFinCoachV2Runtime(providerRuntimeEnv({
      FINCOACH_V2_SYMBOLS: "EUR_USD",
      FINCOACH_V2_TIMEFRAMES: "1m",
      FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR: "2",
      FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "2",
      FINCOACH_V2_PROVIDER_CALL_BUDGET: "1",
    }));
    (runtime as unknown as { repositories: unknown }).repositories = runtimeRepositories({
      saveDetectorEvaluation: async (record) => {
        saved.evaluations.push(record);
      },
      observationSave: async (record) => {
        saved.observations.push(record);
        return { inserted: true, record };
      },
    });
    const result = await runtime.runOnce({ requestedBy: "completed-candle-test" });
    assert.equal(result.completed, true);
    assert.equal(fetchCalls, 1);
    assert.equal(saved.evaluations.filter(item => item.status === "attempted").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "completed").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "skipped").length, 0);
    assert.equal(saved.evaluations.some(item => item.reason === "incomplete_latest_candle" || item.reason === "insufficient_completed_candles"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const saved = { evaluations: [] as Array<{ status: string; reason?: string | null; symbol: string; timeframe: string; detectorId: string }>, observations: [] as unknown[] };
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    const candles = oandaCandles("2026-07-31T14:00:00.000Z", 80, "M1");
    candles[candles.length - 1].complete = false;
    return {
      ok: true,
      json: async () => ({ candles }),
    } as Response;
  }) as typeof fetch;
  try {
    const runtime = createFinCoachV2Runtime(providerRuntimeEnv({
      FINCOACH_V2_SYMBOLS: "EUR_USD",
      FINCOACH_V2_TIMEFRAMES: "1m",
      FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR: "2",
      FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "2",
      FINCOACH_V2_PROVIDER_CALL_BUDGET: "1",
    }));
    (runtime as unknown as { repositories: unknown }).repositories = runtimeRepositories({
      saveDetectorEvaluation: async (record) => {
        saved.evaluations.push(record);
      },
      observationSave: async (record) => {
        saved.observations.push(record);
        return { inserted: true, record };
      },
    });
    const result = await runtime.runOnce({ requestedBy: "insufficient-completed-candles-test" });
    assert.equal(result.completed, true);
    assert.equal(fetchCalls, 1);
    assert.equal(saved.evaluations.filter(item => item.status === "attempted").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "skipped" && item.reason === "insufficient_completed_candles").length, 2);
    assert.equal(saved.evaluations.filter(item => item.status === "completed").length, 0);
    assert.equal(saved.observations.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  let saveCalled = false;
  const inserted = await createForwardTestsFromRanking({
    repositories: { forwardTesting: { save: async () => { saveCalled = true; throw new Error("must not save"); } } },
    config: { forwardTestingEnabled: false, maxActiveForwardTests: 10 },
    ranking: {
      rankingId: "ranking-disabled",
      policyVersion: "test",
      generatedAt: "2026-07-31T15:00:00.000Z",
      candidates: [],
      focusedPortfolio: { maxFocusedCount: 0, strategies: [], constraints: {} },
      demotions: [],
      retirements: [],
      evidenceGaps: [],
      correlationMatrixReference: "none",
      correlationId: "00000000-0000-4000-8000-000000000010",
      causationId: null,
    },
    rankingEventId: "ranking-event",
    sources: new Map(),
    cycleId: "cycle-disabled",
    correlationId: "00000000-0000-4000-8000-000000000010",
    now: new Date("2026-07-31T15:00:00.000Z"),
  });
  assert.equal(inserted, 0);
  assert.equal(saveCalled, false);
}

{
  const scheduler = new StrategyResearchSchedulerService({ MARKETPILOT_RUN_MODE: "demo_observation" } as NodeJS.ProcessEnv);
  const result = await scheduler.runOnce({ runState: "completed" });
  assert.equal(result.health.status, "idle");
  assert.equal(result.lastSkipReason, "demo_run_completed");
  assert.equal(result.health.safetyBlocks, 0);
}

{
  const router = new TelegramCommandRouter(
    { TELEGRAM_ALLOWED_USER_ID: "123" } as NodeJS.ProcessEnv,
    new TelegramReportingService(new InMemoryTelegramRepository()),
    new InMemoryTelegramRepository(),
  );
  const reply = await router.handle({ command: "/performance", actorId: "123", chatId: "123" });
  assert.match(reply, /Insufficient evidence to estimate profitability/);
}

console.log("v2 runtime composition focused tests passed");

function providerRuntimeEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "false",
    FINCOACH_V2_RESEARCH_DATA_MODE: "provider",
    OANDA_ENV: "practice",
    OANDA_API_TOKEN: "test-token",
    OANDA_ACCOUNT_ID: "test-account",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_PAPER_EXECUTION_ENABLED: "false",
    FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: "false",
    FINCOACH_V2_FORWARD_TESTING_ENABLED: "false",
    FINCOACH_V2_RESEARCH_SIGNAL_ENABLED: "false",
    FINCOACH_V2_TELEGRAM_SIGNAL_PUBLICATION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function runtimeRepositories(overrides: {
  saveDetectorEvaluation?: (record: { status: string; reason?: string | null; symbol: string; timeframe: string; detectorId: string }) => Promise<void> | void;
  observationSave?: (record: unknown) => Promise<unknown> | unknown;
} = {}) {
  const lease = { leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 };
  return {
    orchestration: {
      admitCycle: async ({ cycle, maxCyclesPerDay }: { cycle: unknown; maxCyclesPerDay: number }) => ({ admitted: true, cycle, admittedCount: 1, limit: maxCyclesPerDay, admissionDate: "2026-07-31" }),
      acquireLease: async () => lease,
      renewLease: async () => ({ ...lease, acquiredAt: Date.now(), expiresAt: Date.now() + 1000 }),
      verifyLease: async () => true,
      saveCycle: async (record: unknown) => ({ inserted: true, record }),
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => true,
      recoverStaleCycles: async () => [],
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: {
      save: overrides.observationSave ?? (async (record: unknown) => ({ inserted: true, record })),
      eligibleForHypothesis: async () => [],
      eligibleSemanticGroups: async () => [],
    },
    hypotheses: { save: async (record: unknown) => ({ inserted: true, record }) },
    strategies: { save: async (record: unknown) => ({ inserted: true, record }) },
    experiments: { save: async (record: unknown) => ({ inserted: true, record }) },
    backtests: { save: async (record: unknown) => ({ inserted: true, record }) },
    courtroom: { save: async (record: unknown) => ({ inserted: true, record }) },
    ranking: { save: async (record: unknown) => ({ inserted: true, record }) },
    operations: { saveDetectorEvaluation: overrides.saveDetectorEvaluation ?? (async () => undefined) },
    pilot: {},
    forwardTesting: { save: async () => { throw new Error("forward testing must remain disabled"); } },
    signals: {},
    evaluations: {},
    journal: {},
    learning: {},
    lifecycle: {},
    evolution: {},
    evidence: {},
  };
}

function oandaCandles(start: string, count: number, granularity: string) {
  const step = granularity === "M1" ? 60_000 : 15 * 60_000;
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const base = 1 + index * 0.0001;
    return {
      time: new Date(startMs + index * step).toISOString(),
      complete: true,
      mid: {
        o: base.toFixed(6),
        h: (base + 0.0005).toFixed(6),
        l: (base - 0.0005).toFixed(6),
        c: (base + 0.0002).toFixed(6),
      },
      volume: 100 + index,
    };
  });
}
