import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import type { Alert } from "@shared/schema";
import { storage } from "./storage";
import { portfolioRiskAnalyticsService } from "./portfolioRiskAnalyticsService";
import { marketMoveInvestigationService } from "./marketMoveInvestigationService";
import { strategySuggestionService } from "./strategySuggestionService";
import { predictionReviewService } from "./predictionReviewService";
import { postTradeReviewService } from "./execution/postTradeReviewService";
import { strategyAdaptationService } from "./execution/strategyAdaptationService";
import { strategyLifecycleMonitorService } from "./execution/strategyLifecycleMonitorService";
import { strategyLabService } from "./execution/strategyLabService";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { paperAutomationService } from "./execution/paperAutomation";
import { paperStrategyRuntime } from "./execution/paperStrategyRuntime";
import { liveDataPaperOpsRuntime } from "./execution/liveDataPaperOpsRuntime";
import { executionRiskService, executionAuditLog } from "./execution/riskControls";
import { automationLevelService, AUTOMATION_LEVEL_ACKNOWLEDGEMENT } from "./execution/automationLevels";
import { executionEmergencyState, EmergencyControlService } from "./execution/emergencyControls";
import { paperExecutionProvider } from "./execution/providers";
import { sandboxBrokerAdapters } from "./execution/sandboxAdapters";
import { sandboxBrokerRuntime } from "./execution/sandboxBrokerRuntime";
import { eventLogService } from "./eventLogService";
import { ToolConnectorRegistryService } from "./toolConnectorRegistryService";
import { demoRunService } from "./demoRunService";
import { redactSensitive } from "./execution/credentialVault";
import { signalPriorityService } from "./signalPriorityService";
import { registerTelegramLifecycleListener, type TelegramLifecycleAlert } from "./telegramNotificationBus";
import { publishTelegramLifecycleAlert } from "./telegramNotificationBus";

export type TelegramCommandIntent =
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "portfolio" }
  | { kind: "positions" }
  | { kind: "strategies" }
  | { kind: "signals" }
  | { kind: "watchlist" }
  | { kind: "journal" }
  | { kind: "risk" }
  | { kind: "kill" }
  | { kind: "unfreeze" }
  | { kind: "disable_automation" }
  | { kind: "enable_paper" }
  | { kind: "enable_sandbox" }
  | { kind: "stop_strategy"; target: string }
  | { kind: "start_strategy"; target: string }
  | { kind: "track_trade"; target: string }
  | { kind: "close_paper"; target: string }
  | { kind: "close_sandbox"; target: string }
  | { kind: "explain"; symbol: string }
  | { kind: "strategy"; symbol: string }
  | { kind: "why"; symbol: string }
  | { kind: "debrief" }
  | { kind: "daily" }
  | { kind: "weekly" }
  | { kind: "lessons" }
  | { kind: "system" }
  | { kind: "demo_status" }
  | { kind: "demo_start" }
  | { kind: "demo_pause" }
  | { kind: "demo_resume" }
  | { kind: "demo_stop" }
  | { kind: "demo_report" }
  | { kind: "demo_export" }
  | { kind: "demo_adjustments" }
  | { kind: "demo_risks" }
  | { kind: "autonomy"; level: number }
  | { kind: "confirm"; code: string }
  | { kind: "cancel"; code: string }
  | { kind: "unknown"; text: string };

export type TelegramOutboundMessage = {
  text: string;
  parse_mode?: "MarkdownV2" | "Markdown" | "HTML";
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
  };
  disable_web_page_preview?: boolean;
};

export type TelegramSystemStatus = {
  configured: boolean;
  botTokenConfigured: boolean;
  allowedUserIdConfigured: boolean;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookUrlConfigured: boolean;
  allowedUserId: string | null;
  lastCommand: string | null;
  lastCommandAt: string | null;
  pendingConfirmations: number;
  rateLimit: {
    limited: boolean;
    remaining: number;
    resetAt: string | null;
  };
  productionLiveExecutionBlocked: true;
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    date: number;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
};

type TelegramReply = TelegramOutboundMessage & {
  riskLevel?: "low" | "medium" | "high" | "critical";
};

type PendingConfirmation = {
  codeHash: string;
  codePreview: string;
  actorId: string;
  chatId: number;
  command: TelegramCommandIntent;
  summary: string;
  riskLevel: "medium" | "high" | "critical";
  createdAt: string;
  expiresAt: string;
  finalDecision: "requested" | "confirmed" | "expired" | "rejected";
};

type AuthResult = {
  allowed: boolean;
  reason?: string;
  actorId: string;
  chatId: number;
  updateId: number;
  text: string;
  isGroup: boolean;
  replay: boolean;
  retryAfterSeconds?: number;
};

export class TelegramAuthGuard {
  private readonly seenUpdates = new Map<number, number>();
  private readonly commandWindows = new Map<string, { resetAt: number; count: number }>();
  private lastRateLimit = { limited: false, remaining: 0, resetAt: null as string | null };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly now = () => Date.now()) {}

  authorize(update: TelegramUpdate, secretHeader: string | undefined): AuthResult {
    const updateId = update.update_id;
    const now = this.now();
    this.cleanup(now);

    const message = update.message ?? update.callback_query?.message ?? null;
    const from = update.message?.from ?? update.callback_query?.from ?? null;
    const actorId = from?.id ? String(from.id) : "";
    const chatId = message?.chat.id ?? 0;
    const text = (update.message?.text ?? update.callback_query?.data ?? "").trim();
    const isGroup = Boolean(message && message.chat.type !== "private");

    if (!this.env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Telegram webhook secret is not configured");
    }
    if (!secretHeader || secretHeader !== this.env.TELEGRAM_WEBHOOK_SECRET.trim()) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Invalid Telegram webhook secret");
    }
    const allowedUserId = this.env.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "";
    if (!allowedUserId) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Telegram allowed user ID is not configured");
    }
    if (!actorId || actorId !== allowedUserId) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Unauthorized Telegram user");
    }
    if (isGroup && this.env.TELEGRAM_ALLOW_GROUPS?.trim() !== "true") {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Group and channel chats are disabled");
    }
    if (this.seenUpdates.has(updateId)) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Duplicate Telegram update rejected");
    }
    const limit = this.rateLimit(actorId, now);
    if (!limit.allowed) {
      return this.reject(actorId, chatId, updateId, text, isGroup, "Telegram command rate limit exceeded", limit.retryAfterSeconds);
    }
    this.seenUpdates.set(updateId, now + 10 * 60_000);
    this.lastRateLimit = limit.snapshot;
    return {
      allowed: true,
      actorId,
      chatId,
      updateId,
      text,
      isGroup,
      replay: false,
    };
  }

  snapshot() {
    return {
      ...this.lastRateLimit,
      seenUpdates: this.seenUpdates.size,
    };
  }

  private reject(actorId: string, chatId: number, updateId: number, text: string, isGroup: boolean, reason: string, retryAfterSeconds?: number): AuthResult {
    return {
      allowed: false,
      reason,
      actorId,
      chatId,
      updateId,
      text,
      isGroup,
      replay: reason.toLowerCase().includes("duplicate"),
      retryAfterSeconds,
    };
  }

  private rateLimit(actorId: string, now: number) {
    const windowMs = 60_000;
    const maxRequests = 20;
    const bucket = this.commandWindows.get(actorId);
    if (!bucket || bucket.resetAt <= now) {
      this.commandWindows.set(actorId, { resetAt: now + windowMs, count: 1 });
      return {
        allowed: true,
        retryAfterSeconds: 0,
        snapshot: { limited: false, remaining: maxRequests - 1, resetAt: new Date(now + windowMs).toISOString() },
      };
    }
    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    if (bucket.count > maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        snapshot: { limited: true, remaining: 0, resetAt: new Date(bucket.resetAt).toISOString() },
      };
    }
    return {
      allowed: true,
      retryAfterSeconds: 0,
      snapshot: { limited: false, remaining, resetAt: new Date(bucket.resetAt).toISOString() },
    };
  }

  private cleanup(now: number) {
    for (const [updateId, expiresAt] of Array.from(this.seenUpdates.entries())) {
      if (expiresAt <= now) this.seenUpdates.delete(updateId);
    }
    for (const [actorId, bucket] of Array.from(this.commandWindows.entries())) {
      if (bucket.resetAt <= now) this.commandWindows.delete(actorId);
    }
  }
}

export class TelegramCommandRouter {
  parse(text: string): TelegramCommandIntent {
    const normalized = text.trim();
    const [command, ...rest] = normalized.split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (command.toLowerCase()) {
      case "/start":
        return { kind: "start" };
      case "/help":
        return { kind: "help" };
      case "/status":
        return { kind: "status" };
      case "/portfolio":
        return { kind: "portfolio" };
      case "/positions":
        return { kind: "positions" };
      case "/strategies":
        return { kind: "strategies" };
      case "/signals":
        return { kind: "signals" };
      case "/watchlist":
        return { kind: "watchlist" };
      case "/journal":
        return { kind: "journal" };
      case "/risk":
        return { kind: "risk" };
      case "/kill":
        return { kind: "kill" };
      case "/unfreeze":
        return { kind: "unfreeze" };
      case "/disable_automation":
        return { kind: "disable_automation" };
      case "/enable_paper":
        return { kind: "enable_paper" };
      case "/enable_sandbox":
        return { kind: "enable_sandbox" };
      case "/stop_strategy":
        return { kind: "stop_strategy", target: arg };
      case "/start_strategy":
        return { kind: "start_strategy", target: arg };
      case "/track_trade":
        return { kind: "track_trade", target: arg };
      case "/close_paper":
        return { kind: "close_paper", target: arg };
      case "/close_sandbox":
        return { kind: "close_sandbox", target: arg };
      case "/explain":
        return { kind: "explain", symbol: arg.toUpperCase() };
      case "/strategy":
        return { kind: "strategy", symbol: arg.toUpperCase() };
      case "/why":
        return { kind: "why", symbol: arg.toUpperCase() };
      case "/debrief":
        return { kind: "debrief" };
      case "/daily":
        return { kind: "daily" };
      case "/weekly":
        return { kind: "weekly" };
      case "/lessons":
        return { kind: "lessons" };
      case "/system":
        return { kind: "system" };
      case "/demo_status":
        return { kind: "demo_status" };
      case "/demo_start":
        return { kind: "demo_start" };
      case "/demo_pause":
        return { kind: "demo_pause" };
      case "/demo_resume":
        return { kind: "demo_resume" };
      case "/demo_stop":
        return { kind: "demo_stop" };
      case "/demo_report":
        return { kind: "demo_report" };
      case "/demo_export":
        return { kind: "demo_export" };
      case "/demo_adjustments":
        return { kind: "demo_adjustments" };
      case "/demo_risks":
        return { kind: "demo_risks" };
      case "/autonomy":
      case "/level": {
        const level = Number(arg);
        return Number.isInteger(level) ? { kind: "autonomy", level } : { kind: "unknown", text };
      }
      case "/cancel":
        return { kind: "cancel", code: arg.toUpperCase() };
      default:
        if (/^confirm\s+/i.test(normalized)) {
          return { kind: "confirm", code: normalized.replace(/^confirm\s+/i, "").trim().toUpperCase() };
        }
        if (/^cancel\s+/i.test(normalized)) {
          return { kind: "cancel", code: normalized.replace(/^cancel\s+/i, "").trim().toUpperCase() };
        }
        return { kind: "unknown", text };
    }
  }
}

export class TelegramMessageFormatter {
  format(reply: TelegramReply): TelegramOutboundMessage {
    return {
      text: reply.text.slice(0, 3900),
      parse_mode: reply.parse_mode ?? "Markdown",
      reply_markup: reply.reply_markup,
      disable_web_page_preview: reply.disable_web_page_preview ?? true,
    };
  }

  statusCard(items: string[], buttons: string[] = []) {
    return this.format({
      text: items.slice(0, 5).map((item) => `• ${item}`).join("\n"),
      reply_markup: buttons.length > 0 ? { inline_keyboard: [buttons.map((button) => ({ text: button, callback_data: button }))] } : undefined,
    });
  }

  confirmationCard(summary: string, code: string, expiresAt: string) {
    return this.format({
      text: [
        "Confirmation required.",
        summary,
        `Reply with: CONFIRM ${code}`,
        `Expires at: ${expiresAt}`,
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [[
          { text: `Confirm ${code}`, callback_data: `CONFIRM ${code}` },
          { text: "Cancel", callback_data: `CANCEL ${code}` },
        ]],
      },
    });
  }

  rejection(reason: string) {
    return this.format({
      text: `Request rejected: ${reason}`,
    });
  }
}

export class TelegramAuditLogger {
  private lastCommand: { command: string; at: string; actorId: string } | null = null;

  recordCommand(input: {
    eventType: "telegram.command_requested" | "telegram.command_confirmed" | "telegram.command_rejected" | "telegram.alert_sent";
    actorId: string;
    chatId: number;
    command: string;
    outcome: "accepted" | "rejected" | "created" | "filled" | "blocked";
    riskLevel: "low" | "medium" | "high" | "critical";
    confirmationStatus: "none" | "requested" | "confirmed" | "expired" | "rejected";
    requestId: string;
    payload: Record<string, unknown>;
  }) {
    const createdAt = new Date().toISOString();
    const redactedPayload = redactSensitive(input.payload) as Record<string, unknown>;
    const event = {
      id: input.requestId,
      command: input.command,
      actorId: input.actorId,
      chatId: input.chatId,
      outcome: input.outcome,
      riskLevel: input.riskLevel,
      confirmationStatus: input.confirmationStatus,
      payload: redactedPayload,
      createdAt,
    };
    this.lastCommand = { command: input.command, at: createdAt, actorId: input.actorId };
    executionAuditLog.append({
      action: `telegram.${input.command.replaceAll("/", "").replaceAll(" ", "_")}`,
      outcome: input.outcome,
      correlationId: input.requestId,
      detail: event,
    });
    eventLogService.append({
      type: input.eventType,
      userId: input.actorId,
      sourceService: "telegram-bot",
      correlationId: input.requestId,
      payload: event,
      createdAt,
    });
  }

  snapshot() {
    return this.lastCommand;
  }
}

export type TelegramBotResult = {
  accepted: boolean;
  status: number;
  reply?: TelegramOutboundMessage;
  reason?: string;
  correlationId: string;
};

export class TelegramBotService {
  private readonly auth: TelegramAuthGuard;
  private readonly router = new TelegramCommandRouter();
  private readonly formatter = new TelegramMessageFormatter();
  private readonly audit = new TelegramAuditLogger();
  private readonly emergency = new EmergencyControlService(
    executionRiskService,
    automationLevelService,
    [paperExecutionProvider, ...Object.values(sandboxBrokerAdapters)],
    executionEmergencyState,
  );
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();
  private readonly notifiedAlertIds = new Set<string>();
  private readonly digestAlerts: Array<TelegramLifecycleAlert | Alert> = [];
  private lastSendStatus: { ok: boolean; lastError: string | null; at: string | null } = { ok: false, lastError: null, at: null };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.auth = new TelegramAuthGuard(env);
    registerTelegramLifecycleListener(async (alert) => {
      await this.notifyAlert(alert);
    });
  }

  status(): TelegramSystemStatus {
    return {
      configured: Boolean(this.env.TELEGRAM_BOT_TOKEN?.trim() && this.env.TELEGRAM_ALLOWED_USER_ID?.trim() && this.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
      botTokenConfigured: Boolean(this.env.TELEGRAM_BOT_TOKEN?.trim()),
      allowedUserIdConfigured: Boolean(this.env.TELEGRAM_ALLOWED_USER_ID?.trim()),
      webhookConfigured: Boolean(this.env.TELEGRAM_WEBHOOK_URL?.trim()),
      webhookSecretConfigured: Boolean(this.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
      webhookUrlConfigured: Boolean(this.env.TELEGRAM_WEBHOOK_URL?.trim()),
      allowedUserId: this.env.TELEGRAM_ALLOWED_USER_ID?.trim() ?? null,
      lastCommand: this.audit.snapshot()?.command ?? null,
      lastCommandAt: this.audit.snapshot()?.at ?? null,
      pendingConfirmations: this.pendingConfirmations.size,
      rateLimit: this.auth.snapshot(),
      productionLiveExecutionBlocked: true,
    };
  }

  connectorRegistry() {
    return new ToolConnectorRegistryService(this.env).snapshot();
  }

  async handleWebhook(update: unknown, secretHeader: string | undefined): Promise<TelegramBotResult> {
    const parsed = telegramUpdateSchema.safeParse(update);
    const correlationId = randomUUID();
    if (!parsed.success) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId: "unknown",
        chatId: 0,
        command: "/webhook",
        outcome: "rejected",
        riskLevel: "low",
        confirmationStatus: "none",
        requestId: correlationId,
        payload: { reason: "Invalid Telegram update payload", issues: parsed.error.flatten() },
      });
      return { accepted: false, status: 400, reason: "Invalid Telegram update payload", correlationId };
    }
    const auth = this.auth.authorize(parsed.data, secretHeader);
    if (!auth.allowed) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId: auth.actorId || "unknown",
        chatId: auth.chatId,
        command: auth.text || "/webhook",
        outcome: "rejected",
        riskLevel: "low",
        confirmationStatus: "none",
        requestId: correlationId,
        payload: { reason: auth.reason, retryAfterSeconds: auth.retryAfterSeconds },
      });
      return { accepted: false, status: 403, reason: auth.reason, correlationId };
    }
    const reply = await this.handleCommand(auth.text, auth.actorId, auth.chatId);
    const delivery = await this.sendMessage(auth.chatId, reply);
    return {
      accepted: delivery.ok,
      status: delivery.ok ? 200 : 502,
      reply,
      reason: delivery.reason ?? undefined,
      correlationId,
    };
  }

  async handleCommand(text: string, actorId: string, chatId: number): Promise<TelegramOutboundMessage> {
    const intent = this.router.parse(text);
    if (intent.kind === "confirm") {
      return this.confirm(intent.code, actorId, chatId);
    }
    if (intent.kind === "cancel") {
      return this.cancel(intent.code, actorId, chatId);
    }
    return this.execute(intent, actorId, chatId);
  }

  async notifyAlert(alert: TelegramLifecycleAlert | Alert) {
    if (!this.env.TELEGRAM_BOT_TOKEN?.trim() || !this.env.TELEGRAM_ALLOWED_USER_ID?.trim()) return { sent: false as const, reason: "Telegram is not configured" };
    if (this.notifiedAlertIds.has(alert.id)) return { sent: false as const, reason: "Alert already sent" };
    const chatId = Number(this.env.TELEGRAM_ALLOWED_USER_ID);
    if (!Number.isFinite(chatId)) return { sent: false as const, reason: "Telegram allowed user ID is invalid" };
    const priority = new AlertPriorityRouter().route(alert.severity);
    const message = this.formatter.format({ text: this.describeAlert(alert) });
    if (priority === "digest") {
      this.queueDigestAlert(alert);
      this.notifiedAlertIds.add(alert.id);
      this.audit.recordCommand({
        eventType: "telegram.alert_sent",
        actorId: "system",
        chatId,
        command: "/alert",
        outcome: "created",
        riskLevel: alert.severity === "critical" ? "critical" : "medium",
        confirmationStatus: "none",
        requestId: alert.id,
        payload: { ...(redactSensitive(alert) as Record<string, unknown>), sendStatus: "deferred_to_digest" },
      });
      return { sent: false as const, reason: "Alert deferred to digest" };
    }
    const sent = await this.sendMessage(chatId, message);
    if (sent.ok) this.notifiedAlertIds.add(alert.id);
    this.audit.recordCommand({
      eventType: "telegram.alert_sent",
      actorId: "system",
      chatId,
      command: "/alert",
      outcome: sent.ok ? "accepted" : "rejected",
      riskLevel: alert.severity === "critical" ? "critical" : "medium",
      confirmationStatus: "none",
      requestId: sent.correlationId,
      payload: { ...(redactSensitive(alert) as Record<string, unknown>), sendStatus: sent.ok ? "sent" : sent.reason },
    });
    return sent;
  }

  async setWebhook() {
    const token = this.env.TELEGRAM_BOT_TOKEN?.trim();
    const url = this.env.TELEGRAM_WEBHOOK_URL?.trim();
    const secret = this.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!token || !url || !secret) {
      return { ok: false as const, reason: "Telegram webhook URL, secret, or token is missing." };
    }
    const response = await this.fetcher(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        drop_pending_updates: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false as const, reason: `Telegram setWebhook failed with ${response.status}: ${String(redactSensitive(body)).slice(0, 160)}` };
    }
    return { ok: true as const, reason: null };
  }

  private async execute(intent: TelegramCommandIntent, actorId: string, chatId: number, confirmed = false): Promise<TelegramOutboundMessage> {
    switch (intent.kind) {
      case "start":
      case "help":
        return this.auditReply(intent.kind, actorId, chatId, this.help(), "low");
      case "status":
        return this.auditReply("status", actorId, chatId, await this.statusMessage(), "low");
      case "portfolio":
        return this.auditReply("portfolio", actorId, chatId, await this.portfolioMessage(), "low");
      case "positions":
        return this.auditReply("positions", actorId, chatId, await this.positionsMessage(), "low");
      case "strategies":
        return this.auditReply("strategies", actorId, chatId, await this.strategiesMessage(), "low");
      case "signals":
        return this.auditReply("signals", actorId, chatId, await this.signalsMessage(), "low");
      case "watchlist":
        return this.auditReply("watchlist", actorId, chatId, await this.watchlistMessage(), "low");
      case "journal":
        return this.auditReply("journal", actorId, chatId, await this.journalMessage(), "low");
      case "risk":
        return this.auditReply("risk", actorId, chatId, await this.riskMessage(), "low");
      case "kill":
        return this.auditReply("kill", actorId, chatId, await this.killSwitchMessage(actorId), "critical");
      case "disable_automation":
        return confirmed ? this.disableAutomationMessage(actorId) : this.requestConfirmation(intent, actorId, chatId, "Disable automation", "medium");
      case "enable_paper":
        return confirmed ? this.enableAutomationLevel(3, actorId) : this.requestConfirmation(intent, actorId, chatId, "Enable paper automation", "medium");
      case "enable_sandbox":
        return confirmed ? this.enableAutomationLevel(4, actorId) : this.requestConfirmation(intent, actorId, chatId, "Enable sandbox automation", "high");
      case "unfreeze":
        if (confirmed) {
          await this.emergency.release(actorId, "Telegram unfreeze confirmed");
          return this.formatter.statusCard([
            "Signals and live-permission revocation cleared.",
            "Kill switch remains authoritative.",
            "Production live execution remains blocked.",
          ], ["/status", "/system"]);
        }
        return this.requestConfirmation(intent, actorId, chatId, "Unfreeze signals and live permission revocation", "high");
      case "stop_strategy":
        return confirmed ? this.stopStrategy(intent.target) : this.requestConfirmation(intent, actorId, chatId, `Stop strategy ${intent.target || "(latest)"}`, "medium");
      case "start_strategy":
        return confirmed ? this.startStrategy(intent.target) : this.requestConfirmation(intent, actorId, chatId, `Start strategy ${intent.target || "(latest)"}`, "medium");
      case "track_trade":
        return this.auditReply("track_trade", actorId, chatId, await this.trackTradeMessage(intent.target), "low");
      case "close_paper":
        return confirmed ? this.closePaperTrade(intent.target) : this.requestConfirmation(intent, actorId, chatId, `Close paper trade ${intent.target || "(latest)"}`, "high");
      case "close_sandbox":
        return confirmed ? this.closeSandboxTrade(intent.target) : this.requestConfirmation(intent, actorId, chatId, `Close sandbox trade ${intent.target || "(latest)"}`, "high");
      case "explain":
        return this.auditReply("explain", actorId, chatId, await this.explainMessage(intent.symbol, "Why did this move?"), "low");
      case "why":
        return this.auditReply("why", actorId, chatId, await this.explainMessage(intent.symbol, "Why"), "low");
      case "strategy":
        return this.auditReply("strategy", actorId, chatId, await this.strategyMessage(intent.symbol), "low");
      case "debrief":
      case "daily":
        return this.auditReply(intent.kind, actorId, chatId, await this.debriefMessage("daily"), "low");
      case "weekly":
        return this.auditReply("weekly", actorId, chatId, await this.debriefMessage("weekly"), "low");
      case "lessons":
        return this.auditReply("lessons", actorId, chatId, await this.lessonsMessage(), "low");
      case "system":
        return this.auditReply("system", actorId, chatId, await this.systemMessage(), "low");
      case "demo_status":
        return this.auditReply("demo_status", actorId, chatId, await this.demoStatusMessage(), "low");
      case "demo_start":
        return confirmed ? this.demoStartMessage(actorId) : this.requestConfirmation(intent, actorId, chatId, "Start the 7-day demo run", "high");
      case "demo_pause":
        return this.auditReply("demo_pause", actorId, chatId, await this.demoPauseMessage(actorId), "medium");
      case "demo_resume":
        return confirmed ? this.demoResumeMessage(actorId) : this.requestConfirmation(intent, actorId, chatId, "Resume the 7-day demo run", "high");
      case "demo_stop":
        return confirmed ? this.demoStopMessage(actorId) : this.requestConfirmation(intent, actorId, chatId, "Stop the 7-day demo run", "high");
      case "demo_report":
        return this.auditReply("demo_report", actorId, chatId, await this.demoReportMessage(), "low");
      case "demo_export":
        return this.auditReply("demo_export", actorId, chatId, await this.demoExportMessage(), "low");
      case "demo_adjustments":
        return this.auditReply("demo_adjustments", actorId, chatId, await this.demoAdjustmentsMessage(), "low");
      case "demo_risks":
        return this.auditReply("demo_risks", actorId, chatId, await this.demoRisksMessage(), "low");
      case "autonomy":
        return confirmed ? this.changeAutonomyLevel(intent.level, actorId) : this.requestConfirmation(intent, actorId, chatId, `Set autonomy level to ${intent.level}`, "high");
      case "unknown":
      default:
        return this.auditReply("unknown", actorId, chatId, this.formatter.statusCard([
          "Unknown command.",
          "Send /help for the command list.",
          "Live execution remains blocked.",
        ], ["/help", "/status", "/system"]), "low", "rejected");
    }
  }

  private help() {
    return this.formatter.format({
      text: [
        "*View*",
        "/status /portfolio /positions /strategies /signals /watchlist /journal /risk",
        "*Research*",
        "/explain SYMBOL /why SYMBOL /strategy SYMBOL",
        "*Strategy*",
        "/start_strategy /stop_strategy /track_trade /close_paper /close_sandbox",
        "*Paper/Sandbox*",
        "/enable_paper /enable_sandbox /daily /weekly /debrief",
        "*Demo Run*",
        "/demo_status /demo_start /demo_pause /demo_resume /demo_stop /demo_report /demo_export /demo_adjustments /demo_risks",
        "*Safety*",
        "/kill /disable_automation /unfreeze /autonomy",
        "*Learning*",
        "/lessons /journal /debrief",
        "*System*",
        "/system /help",
        "Confirmation required: /enable_paper /enable_sandbox /start_strategy /stop_strategy /close_paper /close_sandbox /unfreeze /autonomy /disable_automation /demo_start /demo_resume /demo_stop",
        "Live production trading remains disabled by default.",
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [[
          { text: "/status", callback_data: "/status" },
          { text: "/system", callback_data: "/system" },
          { text: "/help", callback_data: "/help" },
          { text: "/demo_status", callback_data: "/demo_status" },
        ]],
      },
    });
  }

  private async statusMessage() {
    const overview = await storage.getMarketPilotOverview();
    const status = this.status();
    const connectors = this.connectorRegistry().connectors.filter((connector) => connector.enabled || connector.health !== "disabled").slice(0, 3);
    const items = [
      `Automation level: ${automationLevelService.snapshot().level} (${automationLevelService.snapshot().name})`,
      `Kill switch: ${executionRiskService.snapshot().globalKillSwitch ? "triggered" : "armed"}`,
      `Telegram: ${status.configured ? "configured" : "not configured"}`,
      `Portfolio cash: ${overview.portfolio.cash}`,
      `Digest alerts: ${this.digestAlerts.length}`,
      `Connectors healthy: ${connectors.map((connector) => `${connector.name}=${connector.health}`).join(", ") || "none"}`,
    ];
    return this.formatter.statusCard(items, ["/portfolio", "/positions", "/system"]);
  }

  private async portfolioMessage() {
    const overview = await storage.getMarketPilotOverview();
    const risk = portfolioRiskAnalyticsService.analyze(overview.portfolio);
    return this.formatter.statusCard([
      `Cash: ${overview.portfolio.cash}`,
      `Value: ${overview.portfolio.totalValue}`,
      `VaR 95%: ${risk.valueAtRisk95}`,
      `Largest holding: ${risk.largestPosition.symbol} ${risk.largestPosition.allocation.toFixed(1)}%`,
      `Risk breaches: ${risk.riskBreaches.length || "none"}`,
    ], ["/risk", "/positions", "/journal"]);
  }

  private async positionsMessage() {
    const openPaper = paperStrategyRuntime.listOpen().slice(0, 3);
    const items = openPaper.length > 0
      ? openPaper.map((position) => `${position.strategyId} ${position.symbol} ${position.side} ${position.units}`)
      : ["No open paper positions."];
    return this.formatter.statusCard(items, ["/signals", "/track_trade", "/debrief"]);
  }

  private async strategiesMessage() {
    const strategies = paperAutomationService.listStrategies().slice(0, 3);
    const validations = paperAutomationService.listStrategyValidations();
    const items = strategies.map((strategy) => {
      const validation = validations.find((item) => item.strategyId === strategy.id);
      return `${strategy.name} — ${validation?.verdict ?? "unvalidated"}${validation ? ` (${validation.overallScore})` : ""}`;
    });
    const firstStrategy = strategies[0];
    const buttons = firstStrategy ? ["/system", "/signals", `/stop_strategy ${firstStrategy.id}`] : ["/system", "/signals", "/watchlist"];
    return this.formatter.statusCard(items.length > 0 ? items : ["No strategies registered."], buttons);
  }

  private async signalsMessage() {
    const signals = liveDataPaperOpsRuntime.snapshot().signals.slice(0, 3);
    const items = signals.length > 0
      ? signals.map((signal) => `${String(signal.strategyId)} ${String(signal.symbol)} ${String(signal.status)}`)
      : ["No recent signals."];
    return this.formatter.statusCard(items, ["/watchlist", "/debrief", "/strategy EURUSD"]);
  }

  private async watchlistMessage() {
    const overview = await storage.getMarketPilotOverview();
    const ranked = signalPriorityService.rank(
      [
        ...overview.researchReports.slice(0, 3).map((report) => ({
          id: `research-${report.id}`,
          title: report.title,
          category: "explanation" as const,
          summary: report.mainCause,
          relevanceToGoal: 75,
          marketImpact: report.confidence,
          confidence: report.confidence,
          freshness: 65,
          portfolioExposure: report.asset ? overview.portfolio.holdings.find((holding) => holding.symbol === report.asset)?.allocation ?? 0 : 0,
          riskSeverity: report.riskFactors.length * 15,
          learningValue: 70,
          actionability: report.verification.status === "verified" ? 72 : 45,
          details: report.riskFactors,
        })),
      ],
      5,
    );
    const items = ranked.slice(0, 3).map((signal) => `${signal.title} — ${signal.category}`);
    return this.formatter.statusCard(items.length > 0 ? items : ["No watchlist items ranked."], ["/signals", "/journal", "/strategy MSFT"]);
  }

  private async journalMessage() {
    const reviews = await storage.getJournalReviews();
    const lessons = strategyEvidenceStore.snapshot().rejectedSignals.slice(0, 2);
    const items = [
      ...reviews.slice(0, 2).map((review) => `${review.proficiencyCategory}: ${review.feedback[0] ?? review.journalEntryId}`),
      ...lessons.map((item) => `${item.symbol}: ${item.ruleImprovementSuggestion}`),
    ];
    return this.formatter.statusCard(items.length > 0 ? items : ["No journal reviews available."], ["/lessons", "/debrief", "/system"]);
  }

  private async lessonsMessage() {
    const reviews = await storage.getJournalReviews();
    const pendingAlerts = this.digestAlerts.slice(0, 2);
    const topLessons = [
      ...reviews.slice(0, 2).map((review) => `${review.proficiencyCategory}: ${review.feedback[0] ?? review.journalEntryId}`),
      ...pendingAlerts.map((alert) => `${alert.title}: ${alert.message}`),
    ];
    return this.formatter.statusCard(topLessons.length > 0 ? topLessons : ["No current lessons queued."], ["/journal", "/debrief", "/status"]);
  }

  private async riskMessage() {
    const risk = executionRiskService.snapshot();
    const items = [
      `Global kill switch: ${risk.globalKillSwitch ? "triggered" : "armed"}`,
      `Daily loss: ${risk.dailyLoss}/${risk.maxDailyLoss}`,
      `Drawdown: ${risk.drawdownPct}%/${risk.maxDrawdownPct}%`,
      `Volatility: ${risk.volatilityPct}%/${risk.maxVolatilityPct}%`,
      `Broker connected: ${risk.brokerConnected ? "yes" : "no"}`,
    ];
    return this.formatter.statusCard(items, ["/kill", "/disable_automation", "/system"]);
  }

  private async systemMessage() {
    const telegram = this.status();
    const connectors = this.connectorRegistry().connectors;
    const topConnectors = connectors.slice(0, 3).map((connector) => `${connector.name}: ${connector.health}`);
    const items = [
      `Telegram: ${telegram.configured ? "configured" : "disabled"}`,
      `Allowed user: ${telegram.allowedUserId ?? "missing"}`,
      `Webhook: ${telegram.webhookConfigured ? "configured" : "missing"}`,
      `Last command: ${telegram.lastCommand ?? "none"}`,
      `Pending digest alerts: ${this.digestAlerts.length}`,
      ...topConnectors,
    ];
    return this.formatter.statusCard(items, ["/status", "/portfolio", "/system"]);
  }

  private async demoStatusMessage() {
    const status = await demoRunService.status();
    return this.formatter.statusCard([
      `Run: ${status.state}${status.dayCount ? ` · day ${status.dayCount}/7` : ""}`,
      `Uptime: ${formatDuration(status.uptimeSeconds)}`,
      `Safety: ${status.telemetrySummary.safetyScore}/100`,
      `P/L: ${formatCurrency(status.currentPnL)}`,
      `Blocked: ${status.blockedActions[0] ?? "none"}`,
    ], ["/demo_report", "/demo_adjustments", "/system"]);
  }

  private async demoPauseMessage(actorId: string) {
    const status = await demoRunService.pause("Telegram /demo_pause");
    executionAuditLog.append({
      action: "telegram.demo_pause",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { actorId, productionLiveExecutionBlocked: true },
    });
    return this.formatter.statusCard([
      `Demo run paused.`,
      `State: ${status.state}`,
      `Safety score: ${status.telemetrySummary.safetyScore}/100`,
    ], ["/demo_status", "/system"]);
  }

  private async demoStartMessage(actorId: string) {
    const status = await demoRunService.start();
    executionAuditLog.append({
      action: "telegram.demo_start",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { actorId, productionLiveExecutionBlocked: true },
    });
    return this.formatter.statusCard([
      `Demo run started.`,
      `Run ID: ${status.runId ?? "pending"}`,
      `Allowed symbols: ${status.allowedSymbols.slice(0, 3).join(", ")}`,
    ], ["/demo_status", "/demo_report"]);
  }

  private async demoResumeMessage(actorId: string) {
    const status = await demoRunService.resume("Telegram /demo_resume");
    executionAuditLog.append({
      action: "telegram.demo_resume",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { actorId, productionLiveExecutionBlocked: true },
    });
    return this.formatter.statusCard([
      `Demo run resumed.`,
      `State: ${status.state}`,
      `Safety score: ${status.telemetrySummary.safetyScore}/100`,
    ], ["/demo_status", "/system"]);
  }

  private async demoStopMessage(actorId: string) {
    const status = await demoRunService.stop("Telegram /demo_stop");
    executionAuditLog.append({
      action: "telegram.demo_stop",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { actorId, productionLiveExecutionBlocked: true },
    });
    return this.formatter.statusCard([
      `Demo run stopped.`,
      `Final state: ${status.state}`,
      `Current P/L: ${formatCurrency(status.currentPnL)}`,
    ], ["/demo_report", "/demo_export"]);
  }

  private async demoReportMessage() {
    const report = await demoRunService.report();
    return this.formatter.statusCard([
      `Best strategies: ${report.bestStrategies[0] ?? "none"}`,
      `Weak strategies: ${report.weakStrategies[0] ?? "none"}`,
      `What worked: ${report.whatWorked[0] ?? "none"}`,
      `Next step: ${report.nextDeploymentRecommendation}`,
    ], ["/demo_status", "/demo_adjustments", "/system"]);
  }

  private async demoExportMessage() {
    const exportPayload = await demoRunService.export();
    return this.formatter.statusCard([
      `Export ready.`,
      `Run: ${exportPayload.status.runId ?? "none"}`,
      `Daily reports: ${exportPayload.telemetry.dailyReports.length}`,
      `Adjustments: ${exportPayload.telemetry.adjustments.length}`,
    ], ["/demo_report", "/system"]);
  }

  private async demoAdjustmentsMessage() {
    const exportPayload = await demoRunService.export();
    const latestAdjustments = exportPayload.telemetry.adjustments.slice(0, 3);
    const items = latestAdjustments.length > 0
      ? latestAdjustments.map((adjustment) => `${adjustment.kind.replaceAll("_", " ")}${adjustment.strategyId ? ` · ${adjustment.strategyId}` : ""}`)
      : ["No demo adjustments applied yet."];
    return this.formatter.statusCard(items, ["/demo_risks", "/demo_report", "/system"]);
  }

  private async demoRisksMessage() {
    const telemetry = await demoRunService.telemetry();
    return this.formatter.statusCard([
      `Stale data blocks: ${telemetry.safety.staleDataBlocks}`,
      `Daily loss blocks: ${telemetry.safety.dailyLossBlocks}`,
      `Rejected signals: ${telemetry.safety.rejectedSignals}`,
      `Alert overload: ${telemetry.usability.alertOverloadCount}`,
      `Confirmation failures: ${telemetry.safety.confirmationFailures}`,
    ], ["/kill", "/disable_automation", "/demo_status"]);
  }

  private queueDigestAlert(alert: TelegramLifecycleAlert | Alert) {
    if (this.digestAlerts.some((item) => item.id === alert.id)) return;
    this.digestAlerts.unshift({ ...alert });
    if (this.digestAlerts.length > 25) this.digestAlerts.length = 25;
  }

  private describeAlert(alert: TelegramLifecycleAlert | Alert) {
    if ("category" in alert) {
      return [
        `*${alert.title}*`,
        alert.message,
        `Category: ${alert.category}`,
        `Trigger: ${alert.trigger}`,
        ...(alert.requiredActions?.slice(0, 3).map((action) => `• ${action}`) ?? []),
      ].join("\n");
    }
    return [
      `*${alert.title}*`,
      alert.message,
      ...(alert.requiredActions?.slice(0, 3).map((action) => `• ${action}`) ?? []),
    ].join("\n");
  }

  private auditReply(
    command: string,
    actorId: string,
    chatId: number,
    reply: TelegramOutboundMessage,
    riskLevel: "low" | "medium" | "high" | "critical",
    outcome: "accepted" | "rejected" | "created" = "accepted",
  ) {
    this.audit.recordCommand({
      eventType: outcome === "rejected" ? "telegram.command_rejected" : "telegram.command_requested",
      actorId,
      chatId,
      command,
      outcome,
      riskLevel,
      confirmationStatus: "none",
      requestId: randomUUID(),
      payload: { command, reply: redactSensitive(reply) as Record<string, unknown> },
    });
    return reply;
  }

  private async debriefMessage(period: "daily" | "weekly") {
    const overview = await storage.getMarketPilotOverview();
    const lab = await this.buildStrategyLabSnapshot();
    const closedTrades = paperStrategyRuntime.listClosed();
    const bestTrade = closedTrades[0];
    const worstTrade = [...closedTrades].sort((left, right) => left.realizedPnL - right.realizedPnL)[0];
    const activeStrategies = paperAutomationService.listStrategies().slice(0, 3).map((strategy) => strategy.name);
    const items = [
      `Active strategies: ${activeStrategies.length > 0 ? activeStrategies.join(", ") : "none"}`,
      `Open paper trades: ${paperStrategyRuntime.listOpen().length}`,
      `Best closed trade: ${bestTrade ? `${bestTrade.symbol} ${bestTrade.realizedPnL}` : "none"}`,
      `Worst closed trade: ${worstTrade ? `${worstTrade.symbol} ${worstTrade.realizedPnL}` : "none"}`,
      `Next learning priority: ${lab.learningPriorities.items[0]?.title ?? "none"}`,
    ];
    if (period === "weekly") {
      items.push(`Portfolio risk: ${portfolioRiskAnalyticsService.analyze(overview.portfolio).liquidityScore}/100 liquidity`);
    }
    const digest = this.digestAlerts.slice(0, 2);
    if (digest.length > 0) {
      items.push(...digest.map((alert) => `Alert: ${alert.title}`));
    }
    return this.formatter.statusCard(items, ["/lessons", "/journal", "/strategy-lab"]);
  }

  private async explainMessage(symbol: string, heading: string) {
    const investigation = await marketMoveInvestigationService.investigate(symbol);
    const strategy = strategySuggestionService.suggest({
      prompt: `${heading} ${symbol}`,
      explanation: toExplanation(investigation),
      overview: await storage.getMarketPilotOverview(),
    });
    return this.formatter.statusCard([
      `${investigation.asset}: ${investigation.mainCause}`,
      `Confidence: ${investigation.confidence}`,
      `Strategy: ${strategy.possibleStrategy}`,
      `Risk officer: ${strategy.riskOfficerDecision}`,
    ], ["/strategy " + symbol, "/why " + symbol, "/debrief"]);
  }

  private async strategyMessage(symbol: string) {
    const investigation = await marketMoveInvestigationService.investigate(symbol);
    const strategy = strategySuggestionService.suggest({
      prompt: `Strategy for ${symbol}`,
      explanation: toExplanation(investigation),
      overview: await storage.getMarketPilotOverview(),
    });
    return this.formatter.statusCard([
      `${symbol}: ${strategy.possibleStrategy}`,
      `Best instrument: ${strategy.bestInstrument}`,
      `Confidence: ${strategy.confidence}`,
      `Safer alternative: ${strategy.saferAlternatives[0]}`,
    ], ["/track_trade " + symbol, "/signals", "/watchlist"]);
  }

  private async requestConfirmation(intent: TelegramCommandIntent, actorId: string, chatId: number, summary: string, riskLevel: PendingConfirmation["riskLevel"]) {
    const code = randomConfirmationCode();
    const codeHash = hashCode(code);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    this.pendingConfirmations.set(codeHash, {
      codeHash,
      codePreview: code.slice(0, 2),
      actorId,
      chatId,
      command: intent,
      summary,
      riskLevel,
      createdAt,
      expiresAt,
      finalDecision: "requested",
    });
    this.audit.recordCommand({
      eventType: "telegram.command_requested",
      actorId,
      chatId,
      command: intent.kind,
      outcome: "created",
      riskLevel,
      confirmationStatus: "requested",
      requestId: codeHash,
      payload: { intent, summary, codeHash, expiresAt },
    });
    return this.formatter.confirmationCard(summary, code, expiresAt);
  }

  private async confirm(code: string, actorId: string, chatId: number) {
    const codeHash = hashCode(code);
    const pending = this.pendingConfirmations.get(codeHash);
    if (!pending) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: "confirm",
        outcome: "rejected",
        riskLevel: "medium",
        confirmationStatus: "rejected",
        requestId: codeHash,
        payload: { reason: "Confirmation code not found or already used." },
      });
      return this.formatter.rejection("Confirmation code not found or already used.");
    }
    if (pending.actorId !== actorId || pending.chatId !== chatId) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: "confirm",
        outcome: "rejected",
        riskLevel: pending.riskLevel,
        confirmationStatus: "rejected",
        requestId: codeHash,
        payload: { reason: "Confirmation code does not match this chat or user.", pending: redactSensitive(pending) as Record<string, unknown> },
      });
      return this.formatter.rejection("Confirmation code does not match this chat or user.");
    }
    if (Date.parse(pending.expiresAt) < Date.now()) {
      pending.finalDecision = "expired";
      this.pendingConfirmations.delete(codeHash);
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: "confirm",
        outcome: "rejected",
        riskLevel: pending.riskLevel,
        confirmationStatus: "expired",
        requestId: codeHash,
        payload: { reason: "Confirmation expired", pending: redactSensitive(pending) as Record<string, unknown> },
      });
      return this.formatter.rejection("Confirmation expired.");
    }
    try {
      const reply = await this.execute(pending.command, actorId, chatId, true);
      pending.finalDecision = "confirmed";
      this.pendingConfirmations.delete(codeHash);
      this.audit.recordCommand({
        eventType: "telegram.command_confirmed",
        actorId,
        chatId,
        command: `confirm:${pending.command.kind}`,
        outcome: "accepted",
        riskLevel: pending.riskLevel,
        confirmationStatus: "confirmed",
        requestId: codeHash,
        payload: { pending: redactSensitive(pending) as Record<string, unknown> },
      });
      return reply;
    } catch (error) {
      pending.finalDecision = "rejected";
      this.pendingConfirmations.delete(codeHash);
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: `confirm:${pending.command.kind}`,
        outcome: "rejected",
        riskLevel: pending.riskLevel,
        confirmationStatus: "rejected",
        requestId: codeHash,
        payload: { reason: error instanceof Error ? error.message : String(error), pending: redactSensitive(pending) as Record<string, unknown> },
      });
      return this.formatter.rejection(error instanceof Error ? error.message : String(error));
    }
  }

  private async cancel(code: string, actorId: string, chatId: number) {
    const codeHash = hashCode(code);
    const pending = this.pendingConfirmations.get(codeHash);
    if (!pending) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: "cancel",
        outcome: "rejected",
        riskLevel: "low",
        confirmationStatus: "rejected",
        requestId: codeHash,
        payload: { reason: "Confirmation code not found or already used." },
      });
      return this.formatter.rejection("Confirmation code not found or already used.");
    }
    if (pending.actorId !== actorId || pending.chatId !== chatId) {
      this.audit.recordCommand({
        eventType: "telegram.command_rejected",
        actorId,
        chatId,
        command: "cancel",
        outcome: "rejected",
        riskLevel: pending.riskLevel,
        confirmationStatus: "rejected",
        requestId: codeHash,
        payload: { reason: "Cancellation code does not match this chat or user.", pending: redactSensitive(pending) as Record<string, unknown> },
      });
      return this.formatter.rejection("Cancellation code does not match this chat or user.");
    }
    pending.finalDecision = "rejected";
    this.pendingConfirmations.delete(codeHash);
    this.audit.recordCommand({
      eventType: "telegram.command_rejected",
      actorId,
      chatId,
      command: `cancel:${pending.command.kind}`,
      outcome: "rejected",
      riskLevel: pending.riskLevel,
      confirmationStatus: "rejected",
      requestId: codeHash,
      payload: { pending: redactSensitive(pending) as Record<string, unknown> },
    });
    return this.formatter.statusCard([
      "Confirmation cancelled.",
      "No action executed.",
      "Live execution remains blocked.",
    ], ["/help", "/system"]);
  }

  private async killSwitchMessage(actorId: string) {
    const report = await this.emergency.activate(actorId, "Telegram /kill");
    return this.formatter.statusCard([
      "Kill switch activated.",
      `Closed paper positions: ${report.paperPositionsClosed}`,
      `Automation level: ${report.automationLevel}`,
      `Signals frozen: ${report.signalsFrozen ? "yes" : "no"}`,
    ], ["/status", "/system"]);
  }

  private async disableAutomationMessage(actorId: string) {
    automationLevelService.setLevel(0);
    await liveDataPaperOpsRuntime.enforceAutomationLevel();
    executionAuditLog.append({
      action: "telegram.disable_automation",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { actorId, automationLevel: 0, productionLiveExecutionBlocked: true },
    });
    return this.formatter.statusCard([
      "Automation disabled.",
      "Paper strategies are now enforced off.",
      "Production live execution remains blocked.",
    ], ["/status", "/system"]);
  }

  private async enableAutomationLevel(level: 3 | 4, actorId: string) {
    const overview = await storage.getMarketPilotOverview();
    const validations = paperAutomationService.listStrategyValidations();
    const target = automationLevelService.requestTransition({
      targetLevel: level,
      actorId,
      acknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
      registeredStrategyCount: paperAutomationService.listStrategies().length,
      validatedStrategyCount: validations.filter((item) => item.verdict !== "reject").length,
      constraintsConfigured: overview.riskSettings.maxDailyLossPct > 0,
      monitoringEnabled: true,
      killSwitchAvailable: true,
      sandboxReady: level === 4 ? sandboxBrokerRuntime.configuredProviders().oandaPractice || sandboxBrokerRuntime.configuredProviders().metaTraderDemo : true,
      supervisedPermissionActive: true,
      semiAutonomousApproved: false,
      auditExportReady: true,
      semiAutonomousScope: null,
    });
    await liveDataPaperOpsRuntime.enforceAutomationLevel();
    return target.changed
      ? this.formatter.statusCard([
          `Automation level set to ${level}.`,
          "All safety gates remain active.",
          "Production live execution remains blocked.",
        ], ["/status", "/system"])
      : this.formatter.statusCard([
          `Automation transition rejected: ${target.reasons[0] ?? "unspecified reason"}`,
          "Keep reviewing the safety gates.",
          "Production live execution remains blocked.",
        ], ["/system", "/status"]);
  }

  private async startStrategy(target: string) {
    const strategyId = this.resolveStrategyId(target);
    if (!strategyId) return this.formatter.rejection("Strategy not found.");
    const status = await liveDataPaperOpsRuntime.startStrategy(strategyId);
    return this.formatter.statusCard([
      `Started strategy ${strategyId}.`,
      `Status: ${status?.running ? "running" : "stopped"}`,
      "Paper automation only.",
    ], ["/strategies", "/signals"]);
  }

  private async stopStrategy(target: string) {
    const strategyId = this.resolveStrategyId(target);
    if (!strategyId) return this.formatter.rejection("Strategy not found.");
    const status = await liveDataPaperOpsRuntime.stopStrategy(strategyId);
    return this.formatter.statusCard([
      `Stopped strategy ${strategyId}.`,
      `Status: ${status?.running ? "running" : "stopped"}`,
      "Paper automation only.",
    ], ["/strategies", "/signals"]);
  }

  private async closePaperTrade(target: string) {
    const closed = paperStrategyRuntime.listOpen();
    const match = this.resolveTradeTarget(closed, target);
    if (!match) return this.formatter.rejection("Paper trade not found.");
    const result = paperStrategyRuntime.close(match.id, match.currentPrice ?? match.entryPrice, "manual");
    return this.formatter.statusCard([
      `Closed paper trade ${match.symbol}.`,
      `Realized P/L: ${result.realizedPnL}`,
      `Reason: ${result.exitReason}`,
    ], ["/positions", "/journal"]);
  }

  private async closeSandboxTrade(target: string) {
    const providers = sandboxBrokerRuntime.configuredProviders();
    const provider = providers.metaTraderDemo ? "metatrader_demo" : providers.oandaPractice ? "oanda_practice" : null;
    if (!provider) return this.formatter.rejection("No sandbox provider is configured.");
    const adapter = sandboxBrokerRuntime.adapter(provider);
    const positions = await adapter.getOpenPositions();
    const match = this.resolveSandboxPositionTarget(positions, target);
    if (!match) return this.formatter.rejection("Sandbox trade not found.");
    const closeableAdapter = adapter as typeof adapter & { closePosition?: (positionId: string) => Promise<{ status: string }> };
    if (provider !== "metatrader_demo" || !closeableAdapter.closePosition) {
      return this.formatter.rejection("Close sandbox position is not supported by this provider yet.");
    }
    const result = await closeableAdapter.closePosition(match.id);
    void publishTelegramLifecycleAlert({
      id: `sandbox-position-closed-${match.id}`,
      source: "sandbox",
      eventType: "sandbox.position_closed",
      severity: "info",
      title: "Sandbox position closed",
      message: `${match.instrument} closed with status ${result.status} through ${provider}.`,
      requiredActions: ["Review the sandbox trade timeline", "Check post-trade review readiness"],
      createdAt: new Date().toISOString(),
    });
    return this.formatter.statusCard([
      `Closed sandbox position ${match.instrument}.`,
      `Status: ${result.status}`,
      `Provider: ${provider}`,
    ], ["/positions", "/system"]);
  }

  private async trackTradeMessage(target: string) {
    const open = paperStrategyRuntime.listOpen();
    const closed = paperStrategyRuntime.listClosed();
    const match = this.resolveTradeTarget([...open, ...closed], target);
    if (!match) return this.formatter.rejection("Trade not found.");
    return this.formatter.statusCard([
      `${match.symbol} ${match.side}`,
      `State: ${"closedAt" in match ? "closed" : "open"}`,
      `Entry: ${match.entryPrice}`,
      `Current: ${match.currentPrice ?? match.entryPrice}`,
    ], ["/journal", "/signals"]);
  }

  private async changeAutonomyLevel(level: number, actorId: string) {
    if (![0, 1, 2, 3, 4, 5, 6].includes(level)) {
      return this.formatter.rejection("Autonomy level must be between 0 and 6.");
    }
    const overview = await storage.getMarketPilotOverview();
    const validations = paperAutomationService.listStrategyValidations();
    const transition = automationLevelService.requestTransition({
      targetLevel: level as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      actorId,
      acknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
      registeredStrategyCount: paperAutomationService.listStrategies().length,
      validatedStrategyCount: validations.filter((item) => item.verdict !== "reject").length,
      constraintsConfigured: overview.riskSettings.maxDailyLossPct > 0,
      monitoringEnabled: true,
      killSwitchAvailable: true,
      sandboxReady: sandboxBrokerRuntime.configuredProviders().oandaPractice || sandboxBrokerRuntime.configuredProviders().metaTraderDemo,
      supervisedPermissionActive: true,
      semiAutonomousApproved: false,
      auditExportReady: true,
      semiAutonomousScope: null,
    });
    await liveDataPaperOpsRuntime.enforceAutomationLevel();
    return transition.changed
      ? this.formatter.statusCard([
          `Autonomy level set to ${level}.`,
          "Live execution remains blocked.",
          "Safety gates remain active.",
        ], ["/system", "/status"])
      : this.formatter.statusCard([
          `Autonomy transition rejected: ${transition.reasons[0] ?? "unspecified reason"}`,
          "Live execution remains blocked.",
          "Review the safety gates first.",
        ], ["/system", "/status"]);
  }

  private resolveStrategyId(target: string) {
    const normalized = target.trim().toLowerCase();
    if (!normalized) return paperAutomationService.listStrategies()[0]?.id ?? null;
    return paperAutomationService.listStrategies().find((strategy) =>
      strategy.id.toLowerCase() === normalized
      || strategy.name.toLowerCase().includes(normalized)
      || strategy.allowedInstruments.some((symbol) => symbol.toLowerCase() === normalized),
    )?.id ?? null;
  }

  private resolveTradeTarget(trades: Array<{ id: string; symbol: string; currentPrice?: number; entryPrice: number; side: string }>, target: string) {
    const normalized = target.trim().toLowerCase();
    if (!normalized) return trades[0] ?? null;
    return trades.find((trade) =>
      trade.id.toLowerCase() === normalized
      || trade.symbol.toLowerCase() === normalized,
    ) ?? null;
  }

  private resolveSandboxPositionTarget(positions: Array<{ id: string; instrument: string }>, target: string) {
    const normalized = target.trim().toLowerCase();
    if (!normalized) return positions[0] ?? null;
    return positions.find((position) =>
      position.id.toLowerCase() === normalized
      || position.instrument.toLowerCase() === normalized,
    ) ?? null;
  }

  private async buildStrategyLabSnapshot() {
    const overview = await storage.getMarketPilotOverview();
    const strategies = paperAutomationService.listStrategies();
    const validations = paperAutomationService.listStrategyValidations();
    const validationInputs = paperAutomationService.listStrategyValidationInputs();
    const closedTrades = paperStrategyRuntime.listClosed();
    const postTradeReviews = postTradeReviewService.list();
    const predictionReviews = predictionReviewService.listReviews();
    const journalReviews = await storage.getJournalReviews();
    const adaptations = strategyAdaptationService.list();
    const lifecycleReports = strategyLifecycleMonitorService.list();
    const evidenceRecords = strategyEvidenceStore.snapshot().records;
    const rejectedSignalAnalyses = strategyEvidenceStore.snapshot().rejectedSignals;
    return strategyLabService.build({
      strategies,
      validationInputs,
      scorecards: validations,
      closedTrades,
      postTradeReviews,
      predictionReviews,
      journalReviews,
      adaptations,
      lifecycleReports,
      evidenceRecords,
      rejectedSignalAnalyses,
    }, new Date(overview.auditLogs[0]?.createdAt ?? new Date().toISOString()));
  }

  private async sendMessage(chatId: number, message: TelegramOutboundMessage) {
    const token = this.env.TELEGRAM_BOT_TOKEN?.trim();
    const correlationId = randomUUID();
    if (!token || !chatId) {
      this.lastSendStatus = { ok: false, lastError: "Telegram token or chat ID missing", at: new Date().toISOString() };
      return { ok: false, correlationId, reason: this.lastSendStatus.lastError };
    }
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message.text,
          parse_mode: message.parse_mode ?? "Markdown",
          disable_web_page_preview: message.disable_web_page_preview ?? true,
          ...(message.reply_markup ? { reply_markup: message.reply_markup } : {}),
        }),
      });
      this.lastSendStatus = { ok: response.ok, lastError: response.ok ? null : `Telegram send failed with ${response.status}`, at: new Date().toISOString() };
      return { ok: response.ok, correlationId, reason: response.ok ? undefined : String(redactSensitive(this.lastSendStatus.lastError ?? "Telegram send failed")) };
    } catch (error) {
      this.lastSendStatus = { ok: false, lastError: error instanceof Error ? error.message : String(error), at: new Date().toISOString() };
      return { ok: false, correlationId, reason: String(redactSensitive(this.lastSendStatus.lastError)) };
    }
  }
}

export class AlertPriorityRouter {
  route(severity: "critical" | "warning" | "info") {
    return severity === "critical" ? "immediate" : severity === "warning" ? "digest" : "digest";
  }
}

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    message_id: z.number().int(),
    text: z.string().optional(),
    date: z.number().int(),
    chat: z.object({
      id: z.number().int(),
      type: z.enum(["private", "group", "supergroup", "channel"]),
    }),
    from: z.object({
      id: z.number().int(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }).optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    data: z.string().optional(),
    message: z.object({
      chat: z.object({
        id: z.number().int(),
        type: z.enum(["private", "group", "supergroup", "channel"]),
      }),
    }).optional(),
    from: z.object({
      id: z.number().int(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }).optional(),
  }).optional(),
}).refine((value) => Boolean(value.message || value.callback_query), { message: "Telegram update must include a message or callback query" });

function randomConfirmationCode() {
  return randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatCurrency(value: number) {
  return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

function toExplanation(investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>): any {
  return {
    symbol: investigation.asset,
    primaryCause: investigation.mainCause,
    mainCause: investigation.mainCause,
    secondaryCauses: investigation.supportingEvidence.slice(0, 3),
    evidence: investigation.supportingEvidence,
    contradictoryEvidence: investigation.contradictoryEvidence,
    facts: investigation.facts,
    interpretations: investigation.interpretations,
    predictions: [investigation.decisionCard.mainConclusion],
    whatWouldStrengthen: investigation.whatToWatchNext,
    whatWouldInvalidate: investigation.whatWouldDisprove[0] ?? "Additional contradictory evidence",
    whatCouldReverse: investigation.whatWouldDisprove[0] ?? "Additional contradictory evidence",
    whatWouldWeaken: investigation.whatWouldDisprove.slice(1),
    affectedAssets: [investigation.asset],
    relatedAssets: [investigation.asset],
    alternativeExplanations: [],
    riskFactors: investigation.decisionCard.details.risks as string[],
    verification: {
      id: `telegram-${investigation.asset}`,
      status: investigation.decisionCard.verificationStatus,
      confidence: investigation.confidence,
      reasons: [],
      requiredActions: [],
      checkedAt: new Date().toISOString(),
    },
    confidence: investigation.confidence,
    consensusScore: 0,
    agentAgreementScore: 0,
    scenarioProbabilities: [],
    historicalAnalogues: [],
    pastSimilarEvents: [],
    sourceTimestamps: [],
  } as const;
}

export const telegramBotService = new TelegramBotService();
