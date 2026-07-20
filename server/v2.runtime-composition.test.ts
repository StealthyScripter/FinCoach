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
