import assert from "assert/strict";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
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
  const runtime = createFinCoachV2Runtime(disabledEnv);
  await runtime.initialize();
  const status = runtime.status();
  assert.equal(status.state, "disabled");
  assert.equal(status.liveMoneyExecution, "blocked");
  assert.equal(status.paperExecution, "disabled");
  assert.equal(status.demoBrokerExecution, "disabled");
  assert.equal(status.telegramPublication, "disabled");
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
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_TELEGRAM_TRANSPORT: "disabled",
  } as NodeJS.ProcessEnv);
  (runtime as unknown as { repositories: unknown }).repositories = {
    orchestration: {
      acquireLease: async () => ({ leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 }),
      saveCycle: async (record: unknown) => ({ inserted: true, record }),
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => undefined,
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: { save: save(saved.observations) },
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
