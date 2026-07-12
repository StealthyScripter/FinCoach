import assert from "assert";
import { TelegramClient, loadTelegramConfig, validateTelegramConfig } from "./telegram/telegramClient";
import { InMemoryTelegramRepository } from "./telegram/repository";
import { TelegramSignalPublisher } from "./telegram/signalPublisher";
import { TelegramReportingService } from "./telegram/reportingService";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { TelegramMarketSessionMonitor } from "./telegram/marketSessionMonitor";
import { redactTelegramSecrets } from "./telegram/formatter";
import { TelegramUpdateCursor } from "./telegram/updateCursor";
import { TelegramTransport } from "./telegram/transport";
import { TelegramUpdateReceiver } from "./telegram/updateReceiver";
import { TelegramScheduler } from "./telegram/scheduler";
import type { TelegramSchedulerRunRecord, TelegramSummaryRecord } from "./telegram/contracts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "telegram-token-never-print",
  TELEGRAM_ALLOWED_USER_ID: "123456",
  TELEGRAM_CHAT_ID: "123456",
  TELEGRAM_SIGNAL_CHAT_ID: "-100999888777",
  TELEGRAM_NOTIFICATIONS_ENABLED: "true",
  TELEGRAM_SIGNALS_ENABLED: "true",
  TELEGRAM_MIN_SIGNAL_CONFIDENCE: "75",
  TELEGRAM_MIN_SIGNAL_EVIDENCE_SCORE: "0.75",
  TELEGRAM_SIGNAL_COOLDOWN_MINUTES: "60",
  TELEGRAM_SIGNAL_SIGNING_SECRET: "dedicated-signing-secret",
};

class UniqueSummaryRepository extends InMemoryTelegramRepository {
  async saveSummary(record: TelegramSummaryRecord) {
    const existing = (await this.listSummaries(record.period, 100)).find((summary) => summary.summaryDate === record.summaryDate);
    if (existing) throw new Error('duplicate key value violates unique constraint "idx_telegram_summaries_once"');
    return super.saveSummary(record);
  }
}

class FailingSchedulerRepository extends InMemoryTelegramRepository {
  saveSchedulerRunError: Error | null = null;
  completeSchedulerRunError: Error | null = null;
  completed: Array<{ id: string; status: TelegramSchedulerRunRecord["status"]; details: Record<string, unknown> }> = [];

  async saveSchedulerRun(record: TelegramSchedulerRunRecord) {
    if (this.saveSchedulerRunError) throw this.saveSchedulerRunError;
    return super.saveSchedulerRun(record);
  }

  async completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details: Record<string, unknown> = {}) {
    this.completed.push({ id, status, details });
    if (this.completeSchedulerRunError) throw this.completeSchedulerRunError;
    return super.completeSchedulerRun(id, status, details);
  }
}

async function captureUnhandledRejections(action: () => void | Promise<void>) {
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", handler);
  try {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return rejections;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

{
  const repo = new InMemoryTelegramRepository();
  const client = new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => jsonResponse({ ok: true, result: { message_id: 42 } }));
  const result = await client.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "hello" });
  assert.equal(result.ok, true);
  assert.equal(client.health().consecutiveFailureCount, 0);
  assert.equal((await repo.listDeliveries())[0].status, "sent");
}

{
  const repo = new InMemoryTelegramRepository();
  let calls = 0;
  const client = new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ ok: false, parameters: { retry_after: 1 } }, 429);
    return jsonResponse({ ok: true, result: { message_id: 43 } });
  });
  const result = await client.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "retry" });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.ok((await repo.listDeliveries()).some((delivery) => delivery.status === "sent"));
}

{
  const repo = new InMemoryTelegramRepository();
  const client = new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => {
    throw new Error("network down");
  });
  const result = await client.sendMessage({ kind: "test", destination: "operations", chatId: "123456", text: "failure" });
  assert.equal(result.ok, false);
  assert.equal(client.health().consecutiveFailureCount, 3);
  assert.match(result.errorMessage ?? "", /network down/);
}

{
  const redacted = JSON.stringify(redactTelegramSecrets({ TELEGRAM_BOT_TOKEN: baseEnv.TELEGRAM_BOT_TOKEN, nested: { apiKey: "secret" } }));
  assert.ok(!redacted.includes(baseEnv.TELEGRAM_BOT_TOKEN));
  assert.ok(!redacted.includes("secret"));
}

function validSignal(overrides: Partial<Parameters<TelegramSignalPublisher["publish"]>[0]> = {}) {
  const now = new Date("2026-07-13T10:00:00.000Z");
  return {
    signal: {
      signalId: "11111111-1111-4111-8111-111111111111",
      symbol: "EUR_USD",
      displaySymbol: "EUR/USD",
      side: "buy" as const,
      entryType: "market" as const,
      entryPrice: 1.0842,
      stopLoss: 1.0818,
      takeProfit: 1.0888,
      riskReward: 1.92,
      timeframe: "1h",
      strategyId: "london-compression-breakout",
      strategyVersion: 3,
      experimentId: "experiment-1",
      confidence: 0.82,
      evidenceScore: 0.79,
      generatedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
      reason: "Objective breakout rule passed with fresh data.",
      invalidation: "Cancel if price closes below compression low.",
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
    sourceEventRefs: ["event-1", "event-2", "event-3"],
    ...overrides,
  };
}

{
  const repo = new InMemoryTelegramRepository();
  const client = new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => jsonResponse({ ok: true, result: { message_id: 55 } }));
  const publisher = new TelegramSignalPublisher(client, repo, baseEnv);
  const result = await publisher.publish(validSignal());
  assert.equal(result.published, true);
  assert.equal(result.record.payload.schema, "fincoach.signal.v1");
  assert.equal(result.record.payload.demoOnly, true);
  assert.equal(result.record.payload.signatureAlgorithm, "HMAC-SHA256");
  assert.ok(result.record.humanMessage.includes("```json"));
}

{
  const repo = new InMemoryTelegramRepository();
  const publisher = new TelegramSignalPublisher(new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => jsonResponse({ ok: true, result: { message_id: 56 } })), repo, baseEnv);
  const lowConfidence = await publisher.publish(validSignal({ signal: { ...validSignal().signal, signalId: "22222222-2222-4222-8222-222222222222", confidence: 0.5 } }));
  assert.equal(lowConfidence.published, false);
  assert.ok(lowConfidence.record.rejectionReasons.some((reason) => reason.includes("Confidence")));
  const missingStop = await publisher.publish(validSignal({ signal: { ...validSignal().signal, signalId: "33333333-3333-4333-8333-333333333333", stopLoss: 0 } }));
  assert.equal(missingStop.published, false);
  assert.ok(missingStop.record.rejectionReasons.some((reason) => reason.includes("Stop loss")));
}

{
  const repo = new InMemoryTelegramRepository();
  const publisher = new TelegramSignalPublisher(new TelegramClient(loadTelegramConfig(baseEnv), repo, async () => jsonResponse({ ok: true, result: { message_id: 57 } })), repo, baseEnv);
  const first = await publisher.publish(validSignal({ signal: { ...validSignal().signal, signalId: "44444444-4444-4444-8444-444444444444" } }));
  const second = await publisher.publish(validSignal({ signal: { ...validSignal().signal, signalId: "55555555-5555-4555-8555-555555555555" } }));
  assert.equal(first.published, true);
  assert.equal(second.published, false);
  assert.ok(second.record.rejectionReasons.some((reason) => reason.includes("Duplicate") || reason.includes("cooldown")));
}

{
  const reporting = new TelegramReportingService(new InMemoryTelegramRepository());
  const [perf] = reporting.strategyPerformance([{
    strategyId: "s1",
    name: "Strategy",
    version: 1,
    status: "forward_test",
    instrument: "EUR/USD",
    timeframe: "1h",
    trades: 10,
    wins: 6,
    losses: 4,
    grossProfit: 600,
    grossLoss: -300,
    netProfit: 300,
    capitalAllocated: 3000,
    totalRiskCommitted: 1000,
    maximumDrawdown: 2,
    evidenceScore: 0.8,
    forwardTestDuration: "14d",
    confidenceCalibration: "calibrated",
    promotionState: "watch",
    averageR: 0.3,
  }]);
  assert.equal(perf.winRate, 0.6);
  assert.equal(perf.profitFactor, 2);
  assert.equal(perf.returnPercentage, 10);
  assert.equal(perf.returnOnRiskPercentage, 30);
  const [zero] = reporting.strategyPerformance([{ ...perf, capitalAllocated: 0, totalRiskCommitted: 0, grossLoss: 0 }]);
  assert.equal(zero.returnPercentage, null);
  assert.equal(zero.returnOnRiskPercentage, null);
  assert.equal(zero.profitFactor, null);
}

{
  const repo = new UniqueSummaryRepository();
  const reporting = new TelegramReportingService(repo);
  const first = await reporting.dailySummary(new Date("2026-07-13T22:00:00.000Z"));
  const second = await reporting.dailySummary(new Date("2026-07-13T22:15:00.000Z"));
  assert.equal(second.id, first.id);
  assert.equal((await repo.listSummaries("daily", 10)).length, 1);
}

{
  const repo = new UniqueSummaryRepository();
  const reporting = new TelegramReportingService(repo);
  const first = await reporting.weeklySummary(new Date("2026-07-12T22:00:00.000Z"));
  const second = await reporting.weeklySummary(new Date("2026-07-12T22:30:00.000Z"));
  assert.equal(second.id, first.id);
  assert.equal((await repo.listSummaries("weekly", 10)).length, 1);
}

{
  const repo = new UniqueSummaryRepository();
  const reporting = new TelegramReportingService(repo);
  const scheduler = new TelegramScheduler(repo, { reporting } as never);
  const first = await scheduler.runJob("daily-summary", () => reporting.dailySummary(new Date("2026-07-13T22:00:00.000Z")));
  const second = await scheduler.runJob("daily-summary", () => reporting.dailySummary(new Date("2026-07-13T22:15:00.000Z")));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
}

{
  const repo = new FailingSchedulerRepository();
  repo.saveSchedulerRunError = new Error("scheduler start persistence unavailable");
  const scheduler = new TelegramScheduler(repo);
  const result = await scheduler.runJob("daily-summary", async () => "not reached");
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.match(result.error, /scheduler start persistence unavailable/);
}

{
  const repo = new FailingSchedulerRepository();
  repo.completeSchedulerRunError = new Error("scheduler failure persistence unavailable");
  const scheduler = new TelegramScheduler(repo);
  const result = await scheduler.runJob("daily-summary", async () => {
    throw new Error("summary generation failed");
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.match(result.error, /summary generation failed/);
}

{
  const scheduler = new TelegramScheduler();
  const rejections = await captureUnhandledRejections(() => {
    void scheduler.runJob("daily-summary", async () => {
      throw new Error("timer duplicate summary rejection");
    });
  });
  assert.equal(rejections.length, 0);
}

{
  const repo = new UniqueSummaryRepository();
  const reporting = new TelegramReportingService(repo);
  const dailyOne = reporting.dailySummary(new Date("2026-07-12T22:00:00.000Z"));
  const weeklyOne = reporting.weeklySummary(new Date("2026-07-12T22:00:00.000Z"));
  await Promise.all([dailyOne, weeklyOne]);
  const dailyTwo = await reporting.dailySummary(new Date("2026-07-12T22:30:00.000Z"));
  const weeklyTwo = await reporting.weeklySummary(new Date("2026-07-12T22:30:00.000Z"));
  assert.equal(dailyTwo.summaryDate, "2026-07-12");
  assert.equal(weeklyTwo.summaryDate, "2026-W29");
  assert.equal((await repo.listSummaries("daily", 10)).length, 1);
  assert.equal((await repo.listSummaries("weekly", 10)).length, 1);
}

{
  const router = new TelegramCommandRouter(baseEnv, new TelegramReportingService(new InMemoryTelegramRepository()), new InMemoryTelegramRepository());
  const unauthorized = await router.handle({ command: "/status", actorId: "999", chatId: "123456" });
  assert.match(unauthorized, /unauthorized/i);
  const live = await router.handle({ command: "/enable_live", actorId: "123456", chatId: "123456" });
  assert.match(live, /Blocked/);
  const help = await router.handle({ command: "/help", actorId: "123456", chatId: "123456" });
  assert.match(help, /FinCoach Telegram Commands/);
}

{
  const replies: Array<{ chatId: string; text: string }> = [];
  const transport = new TelegramTransport(
    { handle: async (input) => `reply:${input.command}:${input.actorId}:${input.chatId}` },
    { sendCommandReply: async (chatId, text) => {
      replies.push({ chatId, text });
      return { sent: true as const };
    } },
  );
  const result = await transport.handle({
    source: "telegram",
    updateId: 99,
    chatId: "123456",
    actorId: "123456",
    messageId: "10",
    text: "/status@FinCoachBot now",
    receivedAt: "2026-07-13T10:00:00.000Z",
  });
  assert.equal(result.processed, true);
  assert.deepEqual(replies, [{ chatId: "123456", text: "reply:/status now:123456:123456" }]);

  const ignored = await transport.handle({
    source: "telegram",
    updateId: 100,
    chatId: "123456",
    actorId: "123456",
    messageId: "11",
    text: "hello",
    receivedAt: "2026-07-13T10:00:01.000Z",
  });
  assert.equal(ignored.processed, false);
}

{
  const repo = new InMemoryTelegramRepository();
  const cursor = new TelegramUpdateCursor(repo);
  assert.equal(await cursor.loadOffset(), 0);
  await cursor.saveProcessed(41);
  await cursor.saveProcessed(40);
  assert.equal(await cursor.loadOffset(), 42);
}

{
  const repo = new InMemoryTelegramRepository();
  const cursor = new TelegramUpdateCursor(repo);
  const handled: string[] = [];
  const transport = new TelegramTransport(
    { handle: async (input) => {
      handled.push(input.command);
      return "ok";
    } },
    { sendCommandReply: async () => ({ sent: true as const }) },
  );
  let calls = 0;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        ok: true,
        result: [{
          update_id: 41,
          message: {
            message_id: 5,
            date: 1783936800,
            text: "/help",
            chat: { id: "123456" },
            from: { id: "123456" },
          },
        }],
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  const receiver = new TelegramUpdateReceiver(loadTelegramConfig(baseEnv), cursor, transport, fetcher);
  receiver.start();
  await waitFor(() => handled.length === 1);
  await receiver.stop();
  assert.deepEqual(handled, ["/help"]);
  assert.equal(await cursor.loadOffset(), 42);
}

{
  const config = validateTelegramConfig(loadTelegramConfig({ ...baseEnv, TELEGRAM_SIGNAL_CHAT_ID: "" }));
  assert.equal(config.ok, false);
  assert.ok(config.errors.some((error) => error.includes("TELEGRAM_SIGNAL_CHAT_ID")));
}

{
  const monitor = new TelegramMarketSessionMonitor({ sendOperations: async () => ({ sent: true as const }) } as never);
  const states = monitor.sessionStates(new Date("2026-07-13T07:00:00.000Z"));
  assert.ok(states.some((state) => state.key === "forex-london" && state.open));
  const holidayStates = monitor.sessionStates(new Date("2026-12-25T15:00:00.000Z"));
  assert.ok(holidayStates.some((state) => state.key === "us-equity-regular" && !state.open));
}

console.log("telegramOperations tests passed");
