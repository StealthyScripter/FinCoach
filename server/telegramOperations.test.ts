import assert from "assert";
import { TelegramClient, loadTelegramConfig, validateTelegramConfig } from "./telegram/telegramClient";
import { InMemoryTelegramRepository } from "./telegram/repository";
import { TelegramSignalPublisher } from "./telegram/signalPublisher";
import { TelegramReportingService } from "./telegram/reportingService";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { TelegramMarketSessionMonitor } from "./telegram/marketSessionMonitor";
import { redactTelegramSecrets } from "./telegram/formatter";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
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
  const router = new TelegramCommandRouter(baseEnv, new TelegramReportingService(new InMemoryTelegramRepository()), new InMemoryTelegramRepository());
  const unauthorized = await router.handle({ command: "/status", actorId: "999", chatId: "123456" });
  assert.match(unauthorized, /unauthorized/i);
  const live = await router.handle({ command: "/enable_live", actorId: "123456", chatId: "123456" });
  assert.match(live, /Blocked/);
  const help = await router.handle({ command: "/help", actorId: "123456", chatId: "123456" });
  assert.match(help, /FinCoach Telegram Commands/);
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
