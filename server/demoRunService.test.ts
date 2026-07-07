import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoRunService } from "./demoRunService";
import { paperAutomationService } from "./execution/paperAutomation";
import { redactSensitive } from "./execution/credentialVault";
import { selectDemoRunPrimaryItems } from "../client/src/lib/demoRunDisplay";
import { validateDemoRunEnvironment } from "./demoRunEnvironmentService";
import { startDemoRunScheduler } from "./demoRunScheduler";

const demo = new DemoRunService({
  MARKETPILOT_RUN_MODE: "demo_observation",
});

const tempStrategy = {
  id: `demo-run-test-${Date.now()}`,
  name: "Demo Run Test Strategy",
  type: "trend_following" as const,
  entryRule: "Use demo test entries",
  exitRule: "Use demo test exits",
  stopRule: "Always use a stop",
  riskPerTradePct: 1,
  maxTradesPerDay: 3,
  allowedInstruments: ["EUR/USD"],
  allowedSession: "Always",
  invalidationRule: "Invalidates on test",
  enabled: true,
};

try {
  const envExample = readFileSync(".env.example", "utf-8");
  for (const expected of [
    "MARKETPILOT_RUN_MODE=demo_observation",
    "TELEGRAM_BOT_TOKEN=",
    "TELEGRAM_ALLOWED_USER_ID=",
    "TELEGRAM_WEBHOOK_SECRET=",
    "TELEGRAM_WEBHOOK_URL=",
    "OPENAI_API_KEY=",
    "OPENAI_MODEL=",
    "OANDA_API_TOKEN=",
    "OANDA_ACCOUNT_ID=",
    "METATRADER_BRIDGE_URL=",
    "METATRADER_BRIDGE_SECRET=",
    "TRADINGVIEW_WEBHOOK_SECRET=",
    "FRED_API_KEY=",
    "QDRANT_URL=",
  ]) {
    assert.ok(envExample.includes(expected), `expected .env.example to include ${expected}`);
  }

  const started = await demo.start(new Date("2026-06-01T12:00:00.000Z"));
  assert.equal(started.state, "running");
  assert.equal(started.productionLiveExecutionBlocked, true);
  assert.ok(started.allowedSymbols.includes("EUR/USD"));

  await demo.recordScreenVisit("/system", new Date("2026-06-01T12:01:00.000Z"));
  await demo.recordScreenVisit("/system", new Date("2026-06-01T12:02:00.000Z"));
  await demo.recordScreenVisit("/portfolio", new Date("2026-06-01T12:03:00.000Z"));

  const telemetry = await demo.telemetry(new Date("2026-06-01T12:04:00.000Z"));
  assert.ok(telemetry.generatedAt);
  assert.ok(telemetry.uptimeSeconds >= 0);
  assert.ok(telemetry.usability.mostUsedScreens.length > 0);
  assert.equal(telemetry.usability.mostUsedScreens[0]?.screen, "/system");
  assert.equal(telemetry.safety.dailyLossBlocks >= 0, true);

  const daily = await demo.dailyEvaluation(new Date("2026-06-01T12:05:00.000Z"));
  assert.ok(daily.reliabilityScore >= 0);
  assert.ok(daily.safetyScore >= 0);
  assert.ok(Array.isArray(daily.recommendedChanges));

  await demo.pause("test pause", new Date("2026-06-01T12:06:00.000Z"));
  const resumed = await demo.resume("test resume", new Date("2026-06-01T12:07:00.000Z"));
  assert.equal(resumed.state, "running");

  const stopped = await demo.stop("test stop", new Date("2026-06-01T12:08:00.000Z"));
  assert.equal(stopped.state, "stopped");

  const finalReport = await demo.report(new Date("2026-06-01T12:09:00.000Z"));
  assert.ok(finalReport.nextDeploymentRecommendation.length > 0);
  assert.ok(finalReport.whatWorked.length >= 0);

  const exportPayload = await demo.export(new Date("2026-06-01T12:10:00.000Z"));
  assert.equal(exportPayload.status.state, "stopped");
  assert.ok(exportPayload.telemetry.generatedAt);
  assert.ok(exportPayload.finalReport);

  paperAutomationService.registerStrategy(tempStrategy);
  const lowered = paperAutomationService.updateStrategy(tempStrategy.id, { riskPerTradePct: 0.5, maxTradesPerDay: 2, enabled: false });
  assert.equal(lowered.enabled, false);
  assert.equal(lowered.riskPerTradePct, 0.5);
  assert.equal(lowered.maxTradesPerDay, 2);
  assert.throws(() => paperAutomationService.updateStrategy(tempStrategy.id, { riskPerTradePct: 0.8 }), /cannot increase risk per trade/i);
  assert.throws(() => paperAutomationService.updateStrategy(tempStrategy.id, { maxTradesPerDay: 4 }), /cannot increase trade frequency/i);

  const redacted = redactSensitive({
    telegram_bot_token: "123456789:abcdefghijklmnopqrstuvwxyz",
    telegram_webhook_secret: "webhook-secret",
    OANDA_ACCOUNT_ID: "001-001-1234567-001",
    OPENAI_API_KEY: "sk-testkey",
    webhook_signature: "signature-value",
  }) as Record<string, string>;
  assert.equal(redacted.telegram_bot_token, "[REDACTED]");
  assert.equal(redacted.telegram_webhook_secret, "[REDACTED]");
  assert.equal(redacted.OANDA_ACCOUNT_ID, "[REDACTED]");
  assert.equal(redacted.OPENAI_API_KEY, "[REDACTED]");
  assert.equal(redacted.webhook_signature, "[REDACTED]");

  const primaryItems = selectDemoRunPrimaryItems(
    stopped,
    telemetry,
    finalReport,
  );
  assert.ok(primaryItems.length <= 5);
  assert.match(primaryItems[0] ?? "", /Run:/);
  assert.match(primaryItems[1] ?? "", /Uptime:/);
  assert.match(primaryItems[2] ?? "", /Safety:/);

  const envChecks = validateDemoRunEnvironment({
    DATABASE_URL: "postgresql://user:password@example/db",
    MARKETPILOT_RUN_MODE: "demo_observation",
    TELEGRAM_ALLOWED_USER_ID: "42",
    TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    OANDA_API_TOKEN: "oanda-token",
    OANDA_ACCOUNT_ID: "account",
    OANDA_ENV: "practice",
    METATRADER_DEMO_BRIDGE_URL: "https://bridge.example",
  });
  assert.equal(envChecks.find((item) => item.key === "DATABASE_URL")?.status, "redacted");
  assert.equal(envChecks.find((item) => item.key === "OANDA_ENV")?.status, "configured");
  assert.ok(envChecks.every((item) => item.status !== "invalid"));
  assert.equal(
    validateDemoRunEnvironment({ MARKETPILOT_RUN_MODE: "live", OANDA_ENV: "live" })
      .some((item) => item.status === "invalid"),
    true,
  );
  assert.equal(
    validateDemoRunEnvironment({
      DATABASE_URL: "postgresql://user:password@example/db",
      MARKETPILOT_RUN_MODE: "demo_observation",
      TELEGRAM_CHAT_ID: "42",
      TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    }).find((item) => item.key === "TELEGRAM_ALLOWED_USER_ID")?.status,
    "configured",
  );

  const completionDemo = new DemoRunService({
    MARKETPILOT_RUN_MODE: "demo_observation",
  });
  await completionDemo.start(new Date("2026-06-01T12:00:00.000Z"));
  const completionReport = await completionDemo.report(new Date("2026-06-08T12:00:01.000Z"));
  assert.equal(completionReport.state, "completed");
  assert.ok(completionReport.dailyReports.some((report) => report.date === "2026-06-08" && report.day === 7));
  const completionExport = await completionDemo.export(new Date("2026-06-08T12:00:02.000Z"));
  assert.equal(completionExport.status.state, "completed");
  assert.equal(completionExport.status.dayCount, 7);

  const midnightDemo = new DemoRunService({
    MARKETPILOT_RUN_MODE: "demo_observation",
  });
  await midnightDemo.start(new Date("2026-06-30T20:19:22.383Z"));
  await midnightDemo.dailyEvaluation(new Date("2026-06-30T20:20:00.000Z"));
  const midnightReport = await midnightDemo.report(new Date("2026-07-01T02:00:43.989Z"));
  const midnightStatus = await midnightDemo.status(new Date("2026-07-01T02:00:43.989Z"));
  assert.equal(midnightStatus.dayCount, 1);
  assert.equal(midnightReport.dayCount, 1);
  assert.equal(midnightReport.dailyReports.length, 1);
  assert.equal(midnightReport.dailyReports[0]?.day, 1);

  const schedulerA = startDemoRunScheduler({ MARKETPILOT_RUN_MODE: "demo_observation" });
  const schedulerB = startDemoRunScheduler({ MARKETPILOT_RUN_MODE: "demo_observation" });
  assert.ok(schedulerA);
  assert.equal(schedulerA, schedulerB);
  if (schedulerA) clearInterval(schedulerA);
} finally {
  // No teardown is required for the global demo utilities in this test file.
}

console.log("demoRunService tests passed");
