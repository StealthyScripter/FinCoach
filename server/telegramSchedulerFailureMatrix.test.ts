import assert from "node:assert/strict";
import { Client } from "pg";
import { TelegramClient, loadTelegramConfig } from "./telegram/telegramClient";
import { InMemoryTelegramRepository, PgTelegramRepository, type TelegramRepository } from "./telegram/repository";
import { TelegramReportingService } from "./telegram/reportingService";
import { TelegramScheduler, classifySchedulerError } from "./telegram/scheduler";
import { TelegramLifecycleMonitor, normalizeProcessFailure } from "./telegram/lifecycleMonitor";
import { TelegramMarketSessionMonitor } from "./telegram/marketSessionMonitor";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { TelegramSignalPublisher } from "./telegram/signalPublisher";
import { telegramMetrics } from "./telegram/metrics";
import type { TelegramDeliveryRecord, TelegramSchedulerRunRecord, TelegramSummaryRecord } from "./telegram/contracts";

const scheduleEnv = {
  TELEGRAM_DAILY_SUMMARY_HOUR_UTC: "22",
  TELEGRAM_WEEKLY_SUMMARY_DAY: "0",
  TELEGRAM_WEEKLY_SUMMARY_HOUR_UTC: "22",
  TELEGRAM_BOT_TOKEN: "test-token-never-print",
  TELEGRAM_CHAT_ID: "123456",
  TELEGRAM_SIGNAL_CHAT_ID: "-100111222333",
  TELEGRAM_ALLOWED_USER_ID: "123456",
  TELEGRAM_NOTIFICATIONS_ENABLED: "true",
  TELEGRAM_SIGNALS_ENABLED: "true",
  TELEGRAM_SIGNAL_SIGNING_SECRET: "test-signing-secret",
};

class MatrixRepository extends InMemoryTelegramRepository {
  runs: TelegramSchedulerRunRecord[] = [];
  completeCalls: Array<{ id: string; status: TelegramSchedulerRunRecord["status"]; details: Record<string, unknown> }> = [];
  failSaveRun: Error | null = null;
  failCompleteStatus: TelegramSchedulerRunRecord["status"] | "any" | null = null;
  failFindSummary: Error | null = null;
  failSaveSummary: Error | null = null;
  failMarkDelivered: Error | null = null;
  saveSummaryBarrier: (() => Promise<void>) | null = null;

  async saveSchedulerRun(record: TelegramSchedulerRunRecord) {
    if (this.failSaveRun) throw this.failSaveRun;
    this.runs.push(record);
    return super.saveSchedulerRun(record);
  }

  async completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details: Record<string, unknown> = {}) {
    this.completeCalls.push({ id, status, details });
    if (this.failCompleteStatus === "any" || this.failCompleteStatus === status) throw new Error(`scheduler ${status} persistence failed`);
    await super.completeSchedulerRun(id, status, details);
    const index = this.runs.findIndex((run) => run.id === id);
    if (index >= 0) this.runs[index] = { ...this.runs[index], status, details: { ...this.runs[index].details, ...details }, completedAt: new Date().toISOString() };
  }

  async findSummaryByPeriodAndDate(period: "daily" | "weekly", summaryDate: string) {
    if (this.failFindSummary) throw this.failFindSummary;
    return super.findSummaryByPeriodAndDate(period, summaryDate);
  }

  async saveSummary(record: TelegramSummaryRecord) {
    if (this.saveSummaryBarrier) await this.saveSummaryBarrier();
    if (this.failSaveSummary) throw this.failSaveSummary;
    return super.saveSummary(record);
  }

  async markSummaryDelivered(id: string, deliveryId: string) {
    if (this.failMarkDelivered) throw this.failMarkDelivered;
    return super.markSummaryDelivered(id, deliveryId);
  }
}

function fakeNotifications(options: {
  attempts?: string[];
  deliveryIds?: string[];
  fail?: Error;
  sent?: boolean;
  missingResult?: boolean;
  reason?: string;
} = {}) {
  const attempts = options.attempts ?? [];
  const deliveryIds = options.deliveryIds ?? [];
  return {
    sendOperations: async (_kind: string, text: string) => {
      attempts.push(text);
      if (options.fail) throw options.fail;
      if (options.sent === false) return { sent: false as const, reason: options.reason ?? "telegram delivery failed" };
      if (options.missingResult) return { sent: true as const };
      const id = `delivery-${deliveryIds.length + 1}`;
      deliveryIds.push(id);
      return { sent: true as const, result: { delivery: { id } } };
    },
  };
}

async function withEnv<T>(env: Record<string, string>, action: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await action();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function captureUnhandled(action: () => void | Promise<void>) {
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", handler);
  try {
    await action();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return rejections;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

function metricsDelta(before: ReturnType<typeof telegramMetrics.snapshot>) {
  const after = telegramMetrics.snapshot();
  return {
    completed: after.schedulerJobsCompleted - before.schedulerJobsCompleted,
    failed: after.schedulerJobsFailed - before.schedulerJobsFailed,
    skipped: after.schedulerJobsSkipped - before.schedulerJobsSkipped,
    persistenceFailures: after.schedulerPersistenceFailures - before.schedulerPersistenceFailures,
    automaticSends: after.automaticSummarySends - before.automaticSummarySends,
    suppressed: after.duplicateSummarySendsSuppressed - before.duplicateSummarySendsSuppressed,
  };
}

async function runDaily(repo: MatrixRepository, notifications = fakeNotifications(), now = new Date("2026-07-13T22:05:00.000Z")) {
  const reporting = new TelegramReportingService(repo);
  const scheduler = new TelegramScheduler(repo, { reporting, notifications } as never);
  return scheduler.runJob("daily-summary", () => (scheduler as any).maybeDailySummary(now));
}

function assertLastRun(repo: MatrixRepository, status: TelegramSchedulerRunRecord["status"], message: string) {
  const last = repo.runs.at(-1);
  assert.ok(last, `${message}: scheduler run should be persisted`);
  assert.equal(last.status, status, message);
  return last;
}

await withEnv(scheduleEnv, async () => {
  {
    const repo = new MatrixRepository();
    const attempts: string[] = [];
    const deliveryIds: string[] = [];
    const first = await runDaily(repo, fakeNotifications({ attempts, deliveryIds }));
    const second = await runDaily(repo, fakeNotifications({ attempts, deliveryIds }), new Date("2026-07-13T22:35:00.000Z"));
    assert.equal(first.status, "completed", "first daily summary should complete");
    assert.equal(second.status, "skipped", "second delivered daily summary must be classified as skip");
    assert.equal(second.reason, "summary_already_delivered");
    assert.equal((await repo.listSummaries("daily", 10)).length, 1, "idempotent daily summary should create one row");
    assert.equal(attempts.length, 1, "existing delivered summary must not resend");
    assertLastRun(repo, "skipped", "delivered duplicate should persist skipped status");
  }

  {
    const repo = new MatrixRepository();
    const attempts: string[] = [];
    const deliveryIds: string[] = [];
    const reporting = new TelegramReportingService(repo);
    const scheduler = new TelegramScheduler(repo, { reporting, notifications: fakeNotifications({ attempts, deliveryIds }) } as never);
    const weeklyOne = await scheduler.runJob("weekly-summary", () => (scheduler as any).maybeWeeklySummary(new Date("2026-07-12T22:05:00.000Z")));
    const weeklyTwo = await scheduler.runJob("weekly-summary", () => (scheduler as any).maybeWeeklySummary(new Date("2026-07-12T22:35:00.000Z")));
    const daily = await scheduler.runJob("daily-summary", () => (scheduler as any).maybeDailySummary(new Date("2026-07-12T22:05:00.000Z")));
    assert.equal(weeklyOne.status, "completed");
    assert.equal(weeklyTwo.status, "skipped");
    assert.equal(weeklyTwo.reason, "summary_already_delivered");
    assert.equal(daily.status, "completed");
    assert.equal((await repo.listSummaries("weekly", 10)).length, 1);
    assert.equal((await repo.listSummaries("daily", 10)).length, 1);
    assert.equal(attempts.length, 2, "daily and weekly overlap should each send exactly once");
  }

  {
    const repo = new MatrixRepository();
    const attempts: string[] = [];
    const first = await runDaily(repo, fakeNotifications({ attempts }));
    assert.equal(first.status, "completed");
    const restarted = await runDaily(repo, fakeNotifications({ attempts }), new Date("2026-07-13T22:55:00.000Z"));
    const outside = await runDaily(repo, fakeNotifications({ attempts }), new Date("2026-07-13T23:05:00.000Z"));
    assert.equal(restarted.status, "skipped", "restart in same hour must not duplicate delivery");
    assert.equal(outside.status, "skipped", "outside-window tick must be skipped");
    assert.equal(outside.reason, "outside_window");
    assert.equal(attempts.length, 1);
  }

  {
    const repo = new MatrixRepository();
    const attempts: string[] = [];
    const deliveryIds: string[] = [];
    await new TelegramReportingService(repo).dailySummaryResult(new Date("2026-07-13T22:00:00.000Z"));
    const pending = await runDaily(repo, fakeNotifications({ attempts, deliveryIds }), new Date("2026-07-13T22:15:00.000Z"));
    const duplicate = await runDaily(repo, fakeNotifications({ attempts, deliveryIds }), new Date("2026-07-13T22:30:00.000Z"));
    assert.equal(pending.status, "completed", "existing pending summary should resume delivery once");
    assert.equal(duplicate.status, "skipped");
    assert.equal(attempts.length, 1);
    assert.equal((await repo.listSummaries("daily", 10))[0].deliveryId, "delivery-1");
  }

  {
    const repo = new MatrixRepository();
    const reporting = new TelegramReportingService(repo);
    const attempts: string[] = [];
    const summaries = await Promise.all([
      reporting.dailySummaryResult(new Date("2026-07-13T22:00:00.000Z")),
      reporting.dailySummaryResult(new Date("2026-07-13T22:00:00.000Z")),
    ]);
    assert.equal(summaries[0].summary.id, summaries[1].summary.id);
    const delivered = await runDaily(repo, fakeNotifications({ attempts }), new Date("2026-07-13T22:15:00.000Z"));
    const duplicate = await runDaily(repo, fakeNotifications({ attempts }), new Date("2026-07-13T22:30:00.000Z"));
    assert.equal(delivered.status, "completed");
    assert.equal(duplicate.status, "skipped");
    assert.equal((await repo.listSummaries("daily", 10)).length, 1);
    assert.equal(attempts.length, 1, "duplicate concurrent scheduler calls must not duplicate delivery");
  }

  {
    const repo = new MatrixRepository();
    const scheduler = new TelegramScheduler(repo);
    const emptyExpiry = await scheduler.runJob("signal-expiry", () => (scheduler as any).expireSignals(new Date("2026-07-13T22:00:00.000Z")));
    const monitor = new TelegramMarketSessionMonitor(fakeNotifications() as never);
    await monitor.check(new Date("2026-07-13T12:00:00.000Z"));
    const noTransition = await scheduler.runJob("market-session-alerts", () => monitor.check(new Date("2026-07-13T12:01:00.000Z")));
    assert.equal(emptyExpiry.status, "skipped");
    assert.equal(emptyExpiry.reason, "no_work");
    assert.equal(noTransition.status, "skipped");
    assert.equal(noTransition.reason, "no_work");
  }
});

await withEnv(scheduleEnv, async () => {
  const failureCases: Array<{ name: string; configure: (repo: MatrixRepository) => void; expectedClass: string }> = [
    { name: "PostgreSQL unavailable", configure: (repo) => { repo.failFindSummary = new Error("PostgreSQL connection refused"); }, expectedClass: "persistence" },
    { name: "repository insert failure", configure: (repo) => { repo.failSaveSummary = new Error("summary insert persistence failed"); }, expectedClass: "persistence" },
    { name: "summary lookup failure", configure: (repo) => { repo.failFindSummary = new Error("summary lookup persistence failed"); }, expectedClass: "persistence" },
    { name: "unrelated unique constraint violation", configure: (repo) => { const error = new Error("duplicate key value violates unique constraint unrelated_constraint") as Error & { code: string }; error.code = "23505"; repo.failSaveSummary = error; }, expectedClass: "data_integrity" },
  ];
  for (const item of failureCases) {
    const repo = new MatrixRepository();
    item.configure(repo);
    const before = telegramMetrics.snapshot();
    const result = await runDaily(repo);
    assert.equal(result.status, "failed", `${item.name}: must be visible as controlled failure`);
    assert.equal(result.error.class, item.expectedClass);
    assert.notEqual(result.error.class, "unknown", `${item.name}: should not be silently unknown`);
    assertLastRun(repo, "failed", item.name);
    const delta = metricsDelta(before);
    assert.equal(delta.failed, 1, `${item.name}: failed metric should increment`);
    assert.equal(delta.completed, 0, `${item.name}: success metric must not increment`);
  }
});

await withEnv(scheduleEnv, async () => {
  const malformedRows: Array<{ name: string; row: Partial<TelegramSummaryRecord>; expected: RegExp }> = [
    { name: "malformed persisted summary row", row: { id: "bad", period: "daily", summaryDate: "2026-07-13", conciseMessage: "", report: {}, deliveryId: null, createdAt: "2026-07-13T22:00:00.000Z" }, expected: /missing required summary fields/ },
    { name: "summary row period mismatch", row: { id: "bad", period: "weekly", summaryDate: "2026-07-13", conciseMessage: "bad", report: {}, deliveryId: null, createdAt: "2026-07-13T22:00:00.000Z" }, expected: /invalid summary period/ },
    { name: "corrupted date key", row: { id: "bad", period: "daily", summaryDate: "2026-07-14", conciseMessage: "bad", report: {}, deliveryId: null, createdAt: "2026-07-13T22:00:00.000Z" }, expected: /invalid summary date/ },
  ];
  for (const item of malformedRows) {
    const repo = new MatrixRepository();
    repo.findSummaryByPeriodAndDate = async () => item.row as TelegramSummaryRecord;
    const attempts: string[] = [];
    const result = await runDaily(repo, fakeNotifications({ attempts }));
    assert.equal(result.status, "failed", `${item.name}: malformed data must fail`);
    assert.equal(result.error.class, "data_integrity");
    assert.match(result.error.message, item.expected);
    assert.equal(attempts.length, 0, `${item.name}: malformed summary data must not be sent`);
  }
});

await withEnv(scheduleEnv, async () => {
  {
    const repo = new MatrixRepository();
    const attempts: string[] = [];
    const result = await runDaily(repo, fakeNotifications({ attempts, sent: false, reason: "Telegram API error" }));
    assert.equal(result.status, "completed", "callback completed but delivery result must show not sent");
    assert.equal((result.result as any).sent, false);
    assert.equal((await repo.listSummaries("daily", 10))[0].deliveryId, null, "delivery failure must not mark summary delivered");
    assert.equal(attempts.length, 1);
    const retry = await runDaily(repo, fakeNotifications({ attempts }), new Date("2026-07-13T22:20:00.000Z"));
    assert.equal(retry.status, "completed", "pending failed delivery should retry later");
    assert.equal(attempts.length, 2);
  }

  {
    const repo = new MatrixRepository();
    repo.failMarkDelivered = new Error("delivery id persistence failed");
    const result = await runDaily(repo);
    assert.equal(result.status, "failed", "delivery success but mark-delivered failure must not be clean success");
    assert.equal(result.error.class, "persistence");
    assert.equal((await repo.listSummaries("daily", 10))[0].deliveryId, null);
  }

  {
    const repo = new MatrixRepository();
    const result = await runDaily(repo, fakeNotifications({ missingResult: true }));
    assert.equal(result.status, "completed");
    assert.equal((result.result as any).sent, true);
    assert.equal((await repo.listSummaries("daily", 10))[0].deliveryId, null, "missing delivery result must not mark delivered");
  }

  {
    const repo = new MatrixRepository();
    const result = await runDaily(repo, fakeNotifications({ fail: new Error("notification formatter TypeError") }));
    assert.equal(result.status, "failed");
    assert.equal(result.error.class, "programming");
  }
});

{
  const repo = new MatrixRepository();
  const config = loadTelegramConfig({ ...scheduleEnv, TELEGRAM_NOTIFICATIONS_ENABLED: "true" });
  const apiFailure = new TelegramClient(config, repo, async () => new Response(JSON.stringify({ description: "bad request" }), { status: 400 }));
  const apiResult = await apiFailure.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "TEST ONLY - DO NOT EXECUTE" });
  assert.equal(apiResult.ok, false);
  assert.equal(apiResult.delivery.status, "failed");

  const timeoutClient = new TelegramClient(config, repo, async () => { throw new DOMException("aborted", "AbortError"); });
  const timeoutResult = await timeoutClient.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "TEST ONLY - DO NOT EXECUTE" });
  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.errorCode, "timeout");

  let calls = 0;
  const retryClient = new TelegramClient(config, repo, async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ parameters: { retry_after: 0.001 } }), { status: 429 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
  });
  const retryResult = await retryClient.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "TEST ONLY - DO NOT EXECUTE" });
  assert.equal(retryResult.ok, true);
  assert.equal(calls, 2);
  assert.equal(retryClient.health().consecutiveFailureCount, 0, "rate-limited send that succeeds on retry should recover client health");
}

await withEnv(scheduleEnv, async () => {
  {
    const repo = new MatrixRepository();
    repo.failSaveRun = new Error("scheduler run record cannot be created");
    const before = telegramMetrics.snapshot();
    const result = await runDaily(repo);
    assert.equal(result.status, "failed");
    assert.equal(result.error.class, "persistence");
    const delta = metricsDelta(before);
    assert.equal(delta.persistenceFailures, 1);
    assert.equal(delta.completed, 0, "persistence fails but metrics must not count success");
  }

  {
    const repo = new MatrixRepository();
    repo.failCompleteStatus = "completed";
    const result = await runDaily(repo);
    assert.equal(result.status, "failed", "completion persistence failure must not be mislabeled completed");
    assert.equal(result.error.class, "persistence");
    assert.ok(repo.completeCalls.some((call) => call.status === "failed"), "failed job should attempt failed run record when persistence is available");
  }

  {
    const repo = new MatrixRepository();
    repo.failCompleteStatus = "failed";
    const result = await new TelegramScheduler(repo).runJob("daily-summary", () => { throw new Error("unexpected summary generation failed"); });
    assert.equal(result.status, "failed");
    assert.equal(result.error.class, "unknown");
    assert.ok(repo.runs.length > 0, "failed job must produce scheduler record when initial persistence is available");
  }

  {
    const repo = new MatrixRepository();
    const scheduler = new TelegramScheduler(repo);
    let release!: () => void;
    const first = scheduler.runJob("same-job", () => new Promise((resolve) => { release = () => resolve("ok"); }));
    const overlap = await scheduler.runJob("same-job", () => "should not run");
    assert.equal(overlap.status, "skipped");
    assert.equal(overlap.reason, "already_running");
    release();
    assert.equal((await first).status, "completed");
    assert.equal((await scheduler.runJob("same-job", () => "next")).status, "completed", "runningJobs must clear after success");
  }

  {
    const repo = new MatrixRepository();
    const scheduler = new TelegramScheduler(repo);
    const failed = await scheduler.runJob("clears-after-failure", () => { throw new TypeError("programming error"); });
    const next = await scheduler.runJob("clears-after-failure", () => "next");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.class, "programming");
    assert.equal(next.status, "completed", "runningJobs must clear after callback failure");
  }

  {
    const repo = new MatrixRepository();
    const scheduler = new TelegramScheduler(repo);
    const [daily, weekly] = await Promise.all([
      scheduler.runJob("daily-summary", () => "daily"),
      scheduler.runJob("weekly-summary", () => "weekly"),
    ]);
    assert.equal(daily.status, "completed");
    assert.equal(weekly.status, "completed");
  }

  {
    const repo = new MatrixRepository();
    const scheduler = new TelegramScheduler(repo);
    const rejections = await captureUnhandled(() => {
      void scheduler.runJob("timer-like", () => { throw new Error("contained scheduler failure"); });
    });
    assert.equal(rejections.length, 0, "contained scheduler failure must not reach process unhandledRejection");
  }
});

{
  assert.equal(classifySchedulerError(new TypeError("bad call")).class, "programming");
  assert.equal(classifySchedulerError(new Error("demo-only live execution blocked")).class, "safety");
  assert.equal(classifySchedulerError(new Error("invariant violation: impossible state")).class, "invariant");
  assert.equal(classifySchedulerError(new Error("invalid summary date")).class, "data_integrity");
  assert.equal(classifySchedulerError(new Error("TELEGRAM_CHAT_ID config missing")).class, "configuration");
  assert.equal(classifySchedulerError(new Error("mystery failure")).class, "unknown", "unknown errors must fail closed, not skip");
}

{
  const secret = "secret-token-never-print";
  const sent: string[] = [];
  const monitor = new TelegramLifecycleMonitor(new MatrixRepository(), {
    sendOperations: async (_kind: string, text: string) => {
      sent.push(text);
      return { sent: true as const };
    },
  } as never, { TELEGRAM_BOT_TOKEN: secret } as never);
  monitor.reportUnhandledRejection(new Error(`escaped ${secret}`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  monitor.reportUnhandledRejection(new Error(`escaped ${secret}`));
  monitor.reportUnhandledRejection("different rejection");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sent.length, 2, "dedupe should suppress only identical process alerts");
  assert.ok(sent.every((text) => !text.includes(secret)), "process alert payload must redact secrets");
  assert.ok(sent.every((text) => !text.includes(" at ")), "Telegram alert must not include stack trace");
  assert.equal(normalizeProcessFailure(new Error(`escaped ${secret}`), { TELEGRAM_BOT_TOKEN: secret }).message.includes(secret), false);
}

{
  const sent: string[] = [];
  const monitor = new TelegramLifecycleMonitor(new MatrixRepository(), {
    sendOperations: async (_kind: string, text: string) => {
      sent.push(text);
      throw new Error("Telegram alert delivery failed");
    },
  } as never);
  const rejections = await captureUnhandled(() => monitor.reportUnhandledRejection(new Error("truly unhandled rejection")));
  assert.equal(rejections.length, 0, "process alert failure must not recurse into unhandledRejection");
  assert.equal(sent.length, 1, "truly unhandled rejection should still attempt one alert");
}

{
  const repo = new MatrixRepository();
  const router = new TelegramCommandRouter(scheduleEnv, new TelegramReportingService(repo), repo);
  assert.match(await router.handle({ command: "/status", actorId: "123456", chatId: "123456" }), /FinCoach Status/);
  assert.match(await router.handle({ command: "/kill_status", actorId: "123456", chatId: "123456" }), /Kill switch/i);
  assert.match(await router.handle({ command: "/status", actorId: "999", chatId: "123456" }), /unauthorized/i);
  assert.match(await router.handle({ command: "/enable_live", actorId: "123456", chatId: "123456" }), /Blocked/);
}

{
  const repo = new MatrixRepository();
  const publisher = new TelegramSignalPublisher({
    sendMessage: async () => ({
      ok: true,
      telegramMessageId: "1",
      delivery: minimalDelivery("signal-delivery"),
    }),
  } as any, repo, scheduleEnv);
  const input = validSignal();
  const first = await publisher.publish(input);
  const second = await publisher.publish({ ...input, signal: { ...input.signal, signalId: "66666666-6666-4666-8666-666666666666" } });
  assert.equal(first.published, true);
  assert.equal(second.published, false, "signal deduplication should remain intact");
}

await runPostgresMatrixIfAvailable();

function validSignal() {
  const now = new Date("2026-07-13T10:00:00.000Z");
  return {
    signal: {
      signalId: "77777777-7777-4777-8777-777777777777",
      symbol: "EUR_USD",
      displaySymbol: "EUR/USD",
      side: "buy" as const,
      entryType: "market" as const,
      entryPrice: 1.0842,
      stopLoss: 1.0818,
      takeProfit: 1.0888,
      riskReward: 1.92,
      timeframe: "1h",
      strategyId: "matrix-strategy",
      strategyVersion: 1,
      experimentId: "matrix-experiment",
      confidence: 0.82,
      evidenceScore: 0.79,
      generatedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
      reason: "Objective rule passed.",
      invalidation: "Cancel on invalidation.",
    },
    demoRunRunning: true,
    demoOnlyPolicyHealthy: true,
    killSwitchInactive: true,
    marketDataFresh: true,
    providerHealthAcceptable: true,
    objectiveRuleSetExists: true,
    experimentExists: true,
    backtestEvidenceExists: true,
    validationVerdictPermitsObservation: true,
    stabilityThresholdPasses: true,
    minimumSampleSizePasses: true,
    rewardRiskAcceptable: true,
    eventLineageComplete: true,
    marketSessionAllowsEntry: true,
    majorNewsBlackoutClear: true,
    sourceEventRefs: ["event-a", "event-b", "event-c"],
  };
}

function minimalDelivery(id: string): TelegramDeliveryRecord {
  const now = new Date().toISOString();
  return {
    id,
    kind: "signal",
    destination: "signals",
    chatIdRedacted: "12***56",
    status: "sent",
    textHash: "hash",
    messageId: "1",
    errorCode: null,
    errorMessage: null,
    retryAfterSeconds: null,
    attemptCount: 1,
    latencyMs: 1,
    correlationId: id,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

async function runPostgresMatrixIfAvailable() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("telegram scheduler PostgreSQL matrix skipped: DATABASE_URL is not set");
    return;
  }
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      console.log(`telegram scheduler PostgreSQL matrix skipped: PostgreSQL is unavailable (${code})`);
      return;
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  const repo = new PgTelegramRepository(databaseUrl);
  const unique = `matrix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const daily = `2099-01-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;
  const weekly = `2099-W${String(Math.floor(Math.random() * 40) + 10).padStart(2, "0")}-${unique}`;
  const cleanup = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
  await cleanup.connect();
  try {
    const dailyRows = await Promise.all([
      repo.saveSummary(summaryRecord(`${unique}-daily-a`, "daily", daily)),
      repo.saveSummary(summaryRecord(`${unique}-daily-b`, "daily", daily)),
    ]);
    assert.equal(dailyRows[0].id, dailyRows[1].id, "PostgreSQL duplicate daily inserts should return same row id");
    const weeklyRows = await Promise.all([
      repo.saveSummary(summaryRecord(`${unique}-weekly-a`, "weekly", weekly)),
      repo.saveSummary(summaryRecord(`${unique}-weekly-b`, "weekly", weekly)),
    ]);
    assert.equal(weeklyRows[0].id, weeklyRows[1].id, "PostgreSQL duplicate weekly inserts should return same row id");
    await repo.markSummaryDelivered(dailyRows[0].id, `${unique}-delivery`);
    assert.equal((await repo.findSummaryByPeriodAndDate("daily", daily))?.deliveryId, `${unique}-delivery`);
    const scheduler = new TelegramScheduler(repo);
    const completed = await scheduler.runJob(`${unique}-completed`, () => "ok");
    const failed = await scheduler.runJob(`${unique}-failed`, () => { throw new Error("pg scheduler failure"); });
    assert.equal(completed.status, "completed");
    assert.equal(failed.status, "failed");
  } finally {
    await cleanup.query("DELETE FROM telegram_scheduler_runs WHERE job_name LIKE $1", [`${unique}%`]).catch(() => undefined);
    await cleanup.query("DELETE FROM telegram_summaries WHERE id LIKE $1 OR summary_date LIKE $2", [`${unique}%`, `%${unique}%`]).catch(() => undefined);
    await cleanup.end();
  }
}

function summaryRecord(id: string, period: "daily" | "weekly", summaryDate: string): TelegramSummaryRecord {
  return {
    id,
    period,
    summaryDate,
    conciseMessage: "TEST ONLY - DO NOT EXECUTE",
    report: { test: true },
    deliveryId: null,
    createdAt: new Date().toISOString(),
  };
}

console.log("telegramSchedulerFailureMatrix tests passed");
