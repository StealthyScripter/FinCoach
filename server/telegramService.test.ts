import assert from "node:assert/strict";
import { TelegramAuthGuard, TelegramAuditLogger, TelegramBotService, TelegramCommandRouter } from "./telegramService";
import { automationLevelService } from "./execution/automationLevels";
import { executionEmergencyState } from "./execution/emergencyControls";
import { executionRiskService } from "./execution/riskControls";
import { paperExecutionProvider } from "./execution/providers";
import { sandboxBrokerAdapters } from "./execution/sandboxAdapters";
import { sandboxBrokerRuntime } from "./execution/sandboxBrokerRuntime";
import { executionAuditLog } from "./execution/riskControls";
import { registerTelegramLifecycleListener } from "./telegramNotificationBus";
import { EmergencyControlService } from "./execution/emergencyControls";
import { PaperStrategyRuntime } from "./execution/paperStrategyRuntime";
import { postTradeReviewService } from "./execution/postTradeReviewService";
import { StrategyOpsService } from "./execution/strategyOpsService";
import { paperAutomationService } from "./execution/paperAutomation";

const env = {
  TELEGRAM_BOT_TOKEN: "bot-token",
  TELEGRAM_ALLOWED_USER_ID: "42",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_WEBHOOK_URL: "https://example.com/telegram",
  TELEGRAM_ALLOW_GROUPS: "false",
};

const fakeFetch: typeof fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true }),
  text: async () => JSON.stringify({ ok: true }),
} as Response);

const restoreRisk = executionRiskService.snapshot();
const restoreLevel = automationLevelService.snapshot().level;
const restoreEmergency = {
  livePermissionRevoked: executionEmergencyState.livePermissionRevoked,
  signalsFrozen: executionEmergencyState.signalsFrozen,
};
const restorePaper = snapshotExecutionProvider(paperExecutionProvider);
const restoreSandbox = Object.fromEntries(Object.entries(sandboxBrokerAdapters).map(([key, adapter]) => [key, snapshotSandboxAdapter(adapter as any)]));
let unregisterLifecycleListener: null | (() => void) = null;
let restoreSandboxBrokerAdapter: null | (() => void) = null;

try {
  const guard = new TelegramAuthGuard(env, () => 1_700_000_000_000);
  const update = {
    update_id: 1,
    message: {
      message_id: 1,
      text: "/status",
      date: 1_700_000_000,
      chat: { id: 42, type: "private" as const },
      from: { id: 42, first_name: "Tester" },
    },
  };

  const auth = guard.authorize(update, "webhook-secret");
  assert.equal(auth.allowed, true);
  assert.equal(guard.authorize({ ...update, update_id: 2 }, "wrong-secret").allowed, false);
  assert.equal(guard.authorize({ ...update, update_id: 1 }, "webhook-secret").allowed, false);
  assert.equal(guard.authorize({
    update_id: 3,
    message: { ...update.message, chat: { id: 999, type: "group" as const } },
  }, "webhook-secret").allowed, false);

  const router = new TelegramCommandRouter();
  assert.deepEqual(router.parse("/explain eurusd"), { kind: "explain", symbol: "EURUSD" });
  assert.deepEqual(router.parse("/autonomy 4"), { kind: "autonomy", level: 4 });
  assert.deepEqual(router.parse("CONFIRM ABC123"), { kind: "confirm", code: "ABC123" });
  assert.deepEqual(router.parse("/lessons"), { kind: "lessons" });
  assert.deepEqual(router.parse("CANCEL ABC123"), { kind: "cancel", code: "ABC123" });

  const bot = new TelegramBotService(env, fakeFetch);
  assert.equal(bot.status().allowedUserId, "[REDACTED]");
  const helpReply = await bot.handleCommand("/help", "42", 42);
  assert.match(helpReply.text, /\*View\*/);
  assert.match(helpReply.text, /Confirmation required:/);
  assert.match(helpReply.text, /MarketPilot is demo-only\. Live trading is disabled\./);
  assert.ok(helpReply.reply_markup?.inline_keyboard?.[0]?.some((button) => button.callback_data === "/demo_status"));
  const liveCommand = await bot.handleCommand("/enable live order EUR_USD", "42", 42);
  assert.equal(liveCommand.text, "Blocked: MarketPilot is demo-only and cannot control live accounts.");
  const statusReply = await bot.handleCommand("/status", "42", 42);
  assert.match(statusReply.text, /Telegram/);
  assert.match(statusReply.text, /Kill switch/);
  assert.ok(statusReply.reply_markup?.inline_keyboard?.[0]?.some((button) => button.callback_data === "/system"));

  const demoStatus = await bot.handleCommand("/demo_status", "42", 42);
  assert.match(demoStatus.text, /Run:/);
  assert.match(demoStatus.text, /Safety:/);
  assert.ok(demoStatus.reply_markup?.inline_keyboard?.[0]?.some((button) => button.callback_data === "/demo_report"));
  const demoStart = await bot.handleCommand("/demo_start", "42", 42);
  assert.match(demoStart.text, /CONFIRM/);
  const demoStartCode = demoStart.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(demoStartCode);
  const demoStartConfirmed = await bot.handleCommand(`CONFIRM ${demoStartCode}`, "42", 42);
  assert.match(demoStartConfirmed.text, /Demo run started/);
  const demoPause = await bot.handleCommand("/demo_pause", "42", 42);
  assert.match(demoPause.text, /Demo run paused/);
  const demoResume = await bot.handleCommand("/demo_resume", "42", 42);
  assert.match(demoResume.text, /CONFIRM/);
  const demoResumeCode = demoResume.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(demoResumeCode);
  const demoResumeConfirmed = await bot.handleCommand(`CONFIRM ${demoResumeCode}`, "42", 42);
  assert.match(demoResumeConfirmed.text, /Demo run resumed/);
  const demoStop = await bot.handleCommand("/demo_stop", "42", 42);
  assert.match(demoStop.text, /CONFIRM/);
  const demoStopCode = demoStop.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(demoStopCode);
  const demoStopConfirmed = await bot.handleCommand(`CONFIRM ${demoStopCode}`, "42", 42);
  assert.match(demoStopConfirmed.text, /Demo run stopped/);
  const demoReport = await bot.handleCommand("/demo_report", "42", 42);
  assert.match(demoReport.text, /Best strategies|Preliminary report/);
  const demoExport = await bot.handleCommand("/demo_export", "42", 42);
  assert.match(demoExport.text, /Export ready/);
  const demoAdjustments = await bot.handleCommand("/demo_adjustments", "42", 42);
  assert.match(demoAdjustments.text, /adjustments|No demo adjustments/);
  const demoRisks = await bot.handleCommand("/demo_risks", "42", 42);
  assert.match(demoRisks.text, /Stale data blocks|Rejected signals/);

  const webhookDenied = await bot.handleWebhook(update, "wrong-secret");
  assert.equal(webhookDenied.accepted, false);
  assert.equal(webhookDenied.status, 403);

  executionEmergencyState.signalsFrozen = true;
  const confirmation = await bot.handleCommand("/unfreeze", "42", 42);
  assert.match(confirmation.text, /CONFIRM/);
  const code = confirmation.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(code);
  const confirmed = await bot.handleCommand(`CONFIRM ${code}`, "42", 42);
  assert.match(confirmed.text, /Signals restored for demo-only monitoring/);
  assert.equal(executionEmergencyState.signalsFrozen, false);

  automationLevelService.setLevel(3);
  const disabled = await bot.handleCommand("/disable_automation", "42", 42);
  assert.match(disabled.text, /CONFIRM/);
  const disabledCode = disabled.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(disabledCode);
  const disabledConfirmed = await bot.handleCommand(`CONFIRM ${disabledCode}`, "42", 42);
  assert.match(disabledConfirmed.text, /Automation disabled/);
  assert.equal(automationLevelService.snapshot().level, 0);

  const kill = await bot.handleCommand("/kill", "42", 42);
  assert.match(kill.text, /Kill switch activated/);
  assert.equal(executionRiskService.snapshot().globalKillSwitch, true);
  assert.equal(executionEmergencyState.signalsFrozen, true);

  executionRiskService.update({ globalKillSwitch: false, dailyLoss: 0, dataAgeSeconds: 0 });
  executionEmergencyState.signalsFrozen = false;

  const lifecycleAlerts: string[] = [];
  unregisterLifecycleListener = registerTelegramLifecycleListener((alert) => lifecycleAlerts.push(alert.eventType));

  const localPaperRuntime = new PaperStrategyRuntime();
  localPaperRuntime.configure({
    strategyId: "paper-hook-strategy",
    name: "Paper Hook Strategy",
    allowedSymbols: ["EUR_USD"],
    maxTradesPerDay: 5,
    maxOpenPositions: 2,
    session: { startHourUtc: 0, endHourUtc: 23 },
    defaultStopDistance: 0.01,
    defaultTakeProfitDistance: 0.02,
    trailingStopDistance: null,
  });
  localPaperRuntime.start("paper-hook-strategy");
  const openTrade = localPaperRuntime.open({
    strategyId: "paper-hook-strategy",
    symbol: "EUR_USD",
    side: "buy",
    units: 1,
    price: 1.1,
    thesis: "Paper hook thesis",
    entryReason: "Entry reason",
    expectedMove: "Upward move",
  });
  const closedTrade = localPaperRuntime.close(openTrade.id, 1.12, "manual");
  localPaperRuntime.stop("paper-hook-strategy");
  postTradeReviewService.reviewPaperTrade(closedTrade);

  const localStrategyOps = new StrategyOpsService();
  localStrategyOps.subscribe({
    id: "pause-hook-strategy",
    name: "Pause Hook Strategy",
    symbols: ["EUR_USD"],
    timeframe: "1m",
    route: "paper",
    enabled: true,
    units: 1,
    evaluate: () => ({ candidate: false, confidence: 10, thesis: "none", entryReason: "none", expectedMove: "none" }),
    quality: () => ({
      sourceReliability: 100,
      strategyValidationScore: 100,
      timeframeQuality: 100,
      trendAlignment: 100,
      volatilityRegime: 100,
      spreadLiquidityCondition: 100,
      recentFalseSignalRate: 0,
      newsRisk: 0,
      riskRewardRatio: 2,
    }),
    riskContext: () => ({
      dataAgeSeconds: 0,
      maxDataAgeSeconds: 60,
      spread: 0,
      maxSpread: 1,
      volatilityPct: 0,
      maxVolatilityPct: 10,
      dailyLoss: 0,
      maxDailyLoss: 1000,
      openPositions: 0,
      maxOpenPositions: 1,
      symbolExposure: 0,
      requestedExposure: 0,
      maxSymbolExposure: 1000,
      correlatedExposure: 0,
      maxCorrelatedExposure: 1000,
      newsBlackoutActive: false,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 4,
      strategyEnabled: true,
      killSwitchActive: false,
      accountConnected: true,
      accountLastSyncAgeSeconds: 0,
      maxAccountSyncAgeSeconds: 60,
    }),
  });
  localStrategyOps.setEnabled("pause-hook-strategy", false);

  const emergency = new EmergencyControlService(executionRiskService, automationLevelService, [paperExecutionProvider, ...Object.values(sandboxBrokerAdapters)]);
  await emergency.activate("42", "Emergency hook test");

  executionRiskService.update({ globalKillSwitch: false, dailyLoss: 0, dataAgeSeconds: 0 });
  executionEmergencyState.signalsFrozen = false;

  const restoreOanda = {
    token: process.env.OANDA_API_TOKEN,
    accountId: process.env.OANDA_ACCOUNT_ID,
    environment: process.env.OANDA_ENV,
    metaTrader: process.env.METATRADER_DEMO_BRIDGE_URL,
  };
  process.env.OANDA_API_TOKEN = "oanda-token";
  process.env.OANDA_ACCOUNT_ID = "oanda-account";
  process.env.OANDA_ENV = "practice";
  delete process.env.METATRADER_DEMO_BRIDGE_URL;

  const sandboxPositions: Array<{ id: string; instrument: string }> = [{ id: "sandbox-pos-1", instrument: "EUR_USD" }];
  let sandboxRejectMode = false;
  const sandboxSubmitIdempotencyKey = `sandbox-idempotency-${Date.now()}`;
  const sandboxRejectIdempotencyKey = `sandbox-idempotency-reject-${Date.now()}`;
  const sandboxAdapter = {
    id: "metatrader_demo",
    productionOrderSubmissionEnabled: false,
    async getAccountSummary() {
      return {
        id: "metatrader-demo-account",
        mode: "demo" as const,
        equity: 100_000,
        currency: "USD",
        lastSyncAt: new Date().toISOString(),
      };
    },
    async previewOrder(request: { instrument: string }) {
      return {
        id: "preview-1",
        provider: "metatrader_demo",
        environment: "sandbox",
        providerSymbol: request.instrument,
        request,
        estimatedPrice: 1.11,
        estimatedMargin: 10,
        estimatedSpreadCost: 1,
        riskSummaryHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        productionOrderSubmissionEnabled: false as const,
      };
    },
    async submitSandboxOrder(preview: { request: { instrument: string } }) {
      if (sandboxRejectMode) {
        return {
          provider: "metatrader_demo",
          orderId: "sandbox-order-rejected",
          status: "rejected" as const,
          reason: "Manual reject mode",
          submittedAt: new Date().toISOString(),
          requestedUnits: 1,
          filledUnits: 0,
          remainingUnits: 1,
          averageFillPrice: null,
          productionOrderSubmissionEnabled: false as const,
        };
      }
      sandboxPositions.push({ id: "sandbox-pos-2", instrument: preview.request.instrument });
      return {
        provider: "metatrader_demo",
        orderId: "sandbox-order-1",
        status: "filled" as const,
        reason: null,
        submittedAt: new Date().toISOString(),
        requestedUnits: 1,
        filledUnits: 1,
        remainingUnits: 0,
        averageFillPrice: 1.11,
        productionOrderSubmissionEnabled: false as const,
      };
    },
    async getOpenPositions() {
      return [...sandboxPositions];
    },
    async closePosition(positionId: string) {
      const index = sandboxPositions.findIndex((position) => position.id === positionId);
      if (index >= 0) sandboxPositions.splice(index, 1);
      return { status: "closed" };
    },
  };
  const originalAdapter = sandboxBrokerRuntime.adapter.bind(sandboxBrokerRuntime);
  restoreSandboxBrokerAdapter = () => {
    (sandboxBrokerRuntime as any).adapter = originalAdapter;
  };
  (sandboxBrokerRuntime as any).adapter = () => sandboxAdapter;

  const runtimePreview = await sandboxBrokerRuntime.preview("metatrader_demo", {
    strategyId: "sandbox-hook-strategy",
    instrument: "EUR_USD",
    side: "buy",
    type: "market",
    units: 1,
    price: 1.11,
    mode: "sandbox",
    explicitUserConfirmation: true,
    correlationId: "sandbox-correlation-1",
  } as any);
  const sandboxResult = await sandboxBrokerRuntime.submit({
    provider: "metatrader_demo",
    previewId: runtimePreview.id,
    riskSummaryHash: runtimePreview.riskSummaryHash,
    confirmationPhrase: "I understand this is a live trade and I accept the risk.",
    idempotencyKey: sandboxSubmitIdempotencyKey,
  });
  assert.equal(sandboxResult.status, "filled");

  sandboxRejectMode = true;
  const runtimeRejectPreview = await sandboxBrokerRuntime.preview("metatrader_demo", {
    strategyId: "sandbox-hook-strategy-reject",
    instrument: "GBP_USD",
    side: "sell",
    type: "market",
    units: 1,
    price: 1.27,
    mode: "sandbox",
    explicitUserConfirmation: true,
    correlationId: "sandbox-correlation-2",
  } as any);
  const sandboxRejectedResult = await sandboxBrokerRuntime.submit({
    provider: "metatrader_demo",
    previewId: runtimeRejectPreview.id,
    riskSummaryHash: runtimeRejectPreview.riskSummaryHash,
    confirmationPhrase: "I understand this is a live trade and I accept the risk.",
    idempotencyKey: sandboxRejectIdempotencyKey,
  });
  assert.equal(sandboxRejectedResult.status, "rejected");
  sandboxRejectMode = false;

  process.env.METATRADER_DEMO_BRIDGE_URL = "https://bridge.example";
  const supportedClose = await bot.handleCommand("/close_sandbox", "42", 42);
  assert.match(supportedClose.text, /CONFIRM/);
  const supportedCloseCode = supportedClose.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(supportedCloseCode);
  const supportedCloseConfirmed = await bot.handleCommand(`CONFIRM ${supportedCloseCode}`, "42", 42);
  assert.match(supportedCloseConfirmed.text, /Closed sandbox position/);
  assert.match(supportedCloseConfirmed.text, /Status: closed/);

  delete process.env.METATRADER_DEMO_BRIDGE_URL;
  sandboxPositions.push({ id: "sandbox-pos-unsupported", instrument: "GBP_USD" });
  delete (sandboxAdapter as any).closePosition;
  const unsupportedClose = await bot.handleCommand("/close_sandbox GBP_USD", "42", 42);
  assert.match(unsupportedClose.text, /CONFIRM/);
  const unsupportedCloseCode = unsupportedClose.text.match(/CONFIRM ([A-Z0-9]+)/)?.[1];
  assert.ok(unsupportedCloseCode);
  const unsupportedCloseConfirmed = await bot.handleCommand(`CONFIRM ${unsupportedCloseCode}`, "42", 42);
  assert.match(unsupportedCloseConfirmed.text, /Close sandbox position is not supported by this provider yet\./);

  executionRiskService.update({ dailyLoss: executionRiskService.snapshot().maxDailyLoss });
  paperAutomationService.registerStrategy({
    id: "paper-auto-daily-loss",
    name: "Paper Auto Daily Loss",
    type: "trend_following",
    entryRule: "trend continuation",
    exitRule: "trend break",
    stopRule: "hard stop",
    riskPerTradePct: 1,
    maxTradesPerDay: 5,
    allowedInstruments: ["EUR_USD"],
    allowedSession: "24x5",
    invalidationRule: "loss limit",
    enabled: true,
  });
  const dailyLossResult = await paperAutomationService.executeSignal({
    symbol: "EUR_USD",
    direction: "buy",
    strategyName: "Paper Auto Daily Loss",
    timeframe: "1m",
    price: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    confidence: 80,
    timestamp: new Date().toISOString(),
  }, "paper-auto-daily-loss");
  assert.equal(dailyLossResult.status, "signal rejected");

  executionRiskService.update({ dailyLoss: 0, dataAgeSeconds: executionRiskService.snapshot().maxDataAgeSeconds + 1 });
  paperAutomationService.registerStrategy({
    id: "paper-auto-stale-data",
    name: "Paper Auto Stale Data",
    type: "trend_following",
    entryRule: "trend continuation",
    exitRule: "trend break",
    stopRule: "hard stop",
    riskPerTradePct: 1,
    maxTradesPerDay: 5,
    allowedInstruments: ["EUR_USD"],
    allowedSession: "24x5",
    invalidationRule: "stale data",
    enabled: true,
  });
  const staleDataResult = await paperAutomationService.executeSignal({
    symbol: "EUR_USD",
    direction: "buy",
    strategyName: "Paper Auto Stale Data",
    timeframe: "1m",
    price: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    confidence: 80,
    timestamp: new Date().toISOString(),
  }, "paper-auto-stale-data");
  assert.equal(staleDataResult.status, "signal rejected");

  if (restoreOanda.token === undefined) delete process.env.OANDA_API_TOKEN;
  else process.env.OANDA_API_TOKEN = restoreOanda.token;
  if (restoreOanda.accountId === undefined) delete process.env.OANDA_ACCOUNT_ID;
  else process.env.OANDA_ACCOUNT_ID = restoreOanda.accountId;
  if (restoreOanda.environment === undefined) delete process.env.OANDA_ENV;
  else process.env.OANDA_ENV = restoreOanda.environment;
  if (restoreOanda.metaTrader === undefined) delete process.env.METATRADER_DEMO_BRIDGE_URL;
  else process.env.METATRADER_DEMO_BRIDGE_URL = restoreOanda.metaTrader;

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(lifecycleAlerts.includes("paper.trade_opened"));
  assert.ok(lifecycleAlerts.includes("paper.trade_closed"));
  assert.ok(lifecycleAlerts.includes("post.trade.review_ready"));
  assert.ok(lifecycleAlerts.includes("strategy.paused"));
  assert.ok(lifecycleAlerts.includes("strategy.stopped"));
  assert.ok(lifecycleAlerts.includes("kill.switch_activated"));
  assert.ok(lifecycleAlerts.includes("sandbox.order_submitted"));
  assert.ok(lifecycleAlerts.includes("sandbox.order_rejected"));
  assert.ok(lifecycleAlerts.includes("sandbox.position_opened"));
  assert.ok(lifecycleAlerts.includes("sandbox.position_closed"));
  assert.ok(lifecycleAlerts.includes("daily.loss_limit_triggered"));
  assert.ok(lifecycleAlerts.includes("stale.data_blocked_strategy"));

  unregisterLifecycleListener?.();
  unregisterLifecycleListener = null;
  restoreSandboxBrokerAdapter?.();
  restoreSandboxBrokerAdapter = null;

  const webhookStatus = await bot.handleWebhook(update, "webhook-secret");
  assert.equal(webhookStatus.accepted, true);
  assert.equal(webhookStatus.status, 200);

  const audit = new TelegramAuditLogger();
  audit.recordCommand({
    eventType: "telegram.command_requested",
    actorId: "42",
    chatId: 42,
    command: "/redact",
    outcome: "created",
    riskLevel: "high",
    confirmationStatus: "requested",
    requestId: "redact-test",
    payload: {
      telegram_bot_token: "bot-token",
      webhook_secret: "webhook-secret",
      broker_api_key: "broker-key",
      accountId: "acct-123",
      openai_api_key: "sk-test-openai-key",
      oanda_api_token: "oanda-token",
      webhook_signature: "signature-value",
      bearer: "Bearer secret-token",
    },
  });
  const auditEntry = executionAuditLog.list().find((entry) => entry.detail && (entry.detail as Record<string, unknown>).command === "/redact")!;
  const redactedPayload = auditEntry.detail.payload as Record<string, unknown>;
  assert.equal(redactedPayload.telegram_bot_token, "[REDACTED]");
  assert.equal(redactedPayload.webhook_secret, "[REDACTED]");
  assert.equal(redactedPayload.broker_api_key, "[REDACTED]");
  assert.equal(redactedPayload.accountId, "[REDACTED]");
  assert.equal(redactedPayload.openai_api_key, "[REDACTED]");
  assert.equal(redactedPayload.oanda_api_token, "[REDACTED]");
  assert.equal(redactedPayload.webhook_signature, "[REDACTED]");
  assert.equal(redactedPayload.bearer, "Bearer [REDACTED]");
} finally {
  unregisterLifecycleListener?.();
  restoreSandboxBrokerAdapter?.();
  executionRiskService.update(restoreRisk);
  automationLevelService.setLevel(restoreLevel);
  executionEmergencyState.livePermissionRevoked = restoreEmergency.livePermissionRevoked;
  executionEmergencyState.signalsFrozen = restoreEmergency.signalsFrozen;
  restoreExecutionProvider(paperExecutionProvider, restorePaper);
  for (const [key, adapter] of Object.entries(sandboxBrokerAdapters)) {
    restoreSandboxAdapter(adapter as any, restoreSandbox[key as keyof typeof restoreSandbox]);
  }
}

console.log("telegramService tests passed");

function snapshotExecutionProvider(provider: any) {
  return {
    orders: [...provider.orders],
    fills: [...provider.fills],
    positions: [...provider.positions],
    connected: provider.connected,
  };
}

function restoreExecutionProvider(provider: any, snapshot: ReturnType<typeof snapshotExecutionProvider>) {
  provider.orders = [...snapshot.orders];
  provider.fills = [...snapshot.fills];
  provider.positions = [...snapshot.positions];
  provider.connected = snapshot.connected;
}

function snapshotSandboxAdapter(adapter: any) {
  return {
    orders: [...adapter.orders],
    positions: [...adapter.positions],
    usedConfirmationIds: new Set(adapter.usedConfirmationIds),
    connected: adapter.connected,
  };
}

function restoreSandboxAdapter(adapter: any, snapshot: ReturnType<typeof snapshotSandboxAdapter>) {
  adapter.orders = [...snapshot.orders];
  adapter.positions = [...snapshot.positions];
  adapter.usedConfirmationIds = new Set(snapshot.usedConfirmationIds);
  adapter.connected = snapshot.connected;
}
