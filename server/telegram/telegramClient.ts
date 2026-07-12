import { randomUUID } from "crypto";
import type { TelegramClientHealth, TelegramConfigValidation, TelegramDeliveryRecord, TelegramEnvironmentConfig, TelegramSendRequest, TelegramSendResult } from "./contracts";
import { emitTelegramEvent } from "./events";
import { hashText, protectTelegramMessageLength, redactChatId, redactedConfig, redactTelegramSecrets } from "./formatter";
import { telegramRepository, type TelegramRepository } from "./repository";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramEnvironmentConfig {
  return {
    botToken: clean(env.TELEGRAM_BOT_TOKEN),
    allowedUserId: clean(env.TELEGRAM_ALLOWED_USER_ID),
    chatId: clean(env.TELEGRAM_CHAT_ID),
    signalChatId: clean(env.TELEGRAM_SIGNAL_CHAT_ID),
    webhookSecret: clean(env.TELEGRAM_WEBHOOK_SECRET),
    webhookUrl: clean(env.TELEGRAM_WEBHOOK_URL),
    notificationsEnabled: parseBool(env.TELEGRAM_NOTIFICATIONS_ENABLED, true),
    signalsEnabled: parseBool(env.TELEGRAM_SIGNALS_ENABLED, true),
    dailySummaryHourUtc: parseIntBounded(env.TELEGRAM_DAILY_SUMMARY_HOUR_UTC, 22, 0, 23),
    weeklySummaryDay: parseIntBounded(env.TELEGRAM_WEEKLY_SUMMARY_DAY, 0, 0, 6),
    weeklySummaryHourUtc: parseIntBounded(env.TELEGRAM_WEEKLY_SUMMARY_HOUR_UTC, 22, 0, 23),
    marketSessionAlerts: parseBool(env.TELEGRAM_MARKET_SESSION_ALERTS, true),
    minSignalConfidence: parseIntBounded(env.TELEGRAM_MIN_SIGNAL_CONFIDENCE, 75, 0, 100),
    minSignalEvidenceScore: parseFloatBounded(env.TELEGRAM_MIN_SIGNAL_EVIDENCE_SCORE, 0.75, 0, 1),
    signalCooldownMinutes: parseIntBounded(env.TELEGRAM_SIGNAL_COOLDOWN_MINUTES, 60, 0, 24 * 60),
    signalSigningSecret: clean(env.TELEGRAM_SIGNAL_SIGNING_SECRET),
  };
}

export function validateTelegramConfig(config: TelegramEnvironmentConfig): TelegramConfigValidation {
  const errors = [
    config.notificationsEnabled && !config.botToken ? "TELEGRAM_BOT_TOKEN is required when notifications are enabled" : null,
    config.notificationsEnabled && !config.chatId ? "TELEGRAM_CHAT_ID is required for operational notifications" : null,
    config.signalsEnabled && !config.botToken ? "TELEGRAM_BOT_TOKEN is required when signals are enabled" : null,
    config.signalsEnabled && !config.signalChatId ? "TELEGRAM_SIGNAL_CHAT_ID is required for signal delivery; fail closed" : null,
    config.botToken && config.signalSigningSecret && config.botToken === config.signalSigningSecret ? "TELEGRAM_SIGNAL_SIGNING_SECRET must not reuse TELEGRAM_BOT_TOKEN" : null,
  ].filter((item): item is string => Boolean(item));
  const warnings = [
    !config.webhookSecret ? "TELEGRAM_WEBHOOK_SECRET is not configured; webhook command intake will fail closed" : null,
    !config.allowedUserId ? "TELEGRAM_ALLOWED_USER_ID is not configured; commands will fail closed" : null,
  ].filter((item): item is string => Boolean(item));
  return { ok: errors.length === 0, errors, warnings, redacted: redactedConfig(config) };
}

export class TelegramClient {
  private lastSuccessfulSendAt: string | null = null;
  private lastFailedSendAt: string | null = null;
  private consecutiveFailureCount = 0;
  private rateLimitedUntil: string | null = null;

  constructor(
    private readonly config: TelegramEnvironmentConfig = loadTelegramConfig(),
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  validate() {
    return validateTelegramConfig(this.config);
  }

  health(): TelegramClientHealth {
    return {
      configured: Boolean(this.config.botToken),
      enabled: this.config.notificationsEnabled || this.config.signalsEnabled,
      lastSuccessfulSendAt: this.lastSuccessfulSendAt,
      lastFailedSendAt: this.lastFailedSendAt,
      consecutiveFailureCount: this.consecutiveFailureCount,
      rateLimitedUntil: this.rateLimitedUntil,
    };
  }

  async sendMessage(request: TelegramSendRequest): Promise<TelegramSendResult> {
    return this.sendTelegramMethod("sendMessage", request, {
      chat_id: request.chatId,
      text: protectTelegramMessageLength(request.text),
      parse_mode: request.parseMode,
      disable_web_page_preview: request.disableWebPagePreview ?? true,
    });
  }

  async editMessage(request: TelegramSendRequest & { messageId: string }): Promise<TelegramSendResult> {
    return this.sendTelegramMethod("editMessageText", request, {
      chat_id: request.chatId,
      message_id: request.messageId,
      text: protectTelegramMessageLength(request.text),
      parse_mode: request.parseMode,
      disable_web_page_preview: request.disableWebPagePreview ?? true,
    });
  }

  async sendDocument(request: TelegramSendRequest & { filename: string; content: string; mimeType?: string }): Promise<TelegramSendResult> {
    const text = `${request.text}\n\nDocument export is recorded in metadata: ${request.filename}`;
    return this.sendMessage({ ...request, text, metadata: { ...request.metadata, documentFilename: request.filename, documentHash: hashText(request.content), mimeType: request.mimeType ?? "application/json" } });
  }

  private async sendTelegramMethod(method: string, request: TelegramSendRequest, body: Record<string, unknown>): Promise<TelegramSendResult> {
    const now = new Date().toISOString();
    const delivery: TelegramDeliveryRecord = {
      id: randomUUID(),
      kind: request.kind,
      destination: request.destination,
      chatIdRedacted: redactChatId(request.chatId),
      status: "queued",
      textHash: hashText(request.text),
      messageId: null,
      errorCode: null,
      errorMessage: null,
      retryAfterSeconds: null,
      attemptCount: 0,
      latencyMs: null,
      correlationId: request.correlationId ?? randomUUID(),
      metadata: redactTelegramSecrets(request.metadata ?? {}) as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveDelivery(delivery);
    emitTelegramEvent("TelegramMessageQueued", { delivery }, delivery.correlationId);

    if (!this.config.botToken) {
      return this.fail(delivery, "not_configured", "Telegram bot token is not configured");
    }

    let lastResult: TelegramSendResult | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      delivery.attemptCount = attempt;
      const startedAt = Date.now();
      try {
        const response = await this.fetchWithTimeout(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        delivery.latencyMs = Date.now() - startedAt;
        if (response.status === 429) {
          const retryAfter = await parseRetryAfter(response);
          delivery.status = "rate_limited";
          delivery.retryAfterSeconds = retryAfter;
          delivery.updatedAt = new Date().toISOString();
          this.rateLimitedUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
          await this.repository.updateDelivery(delivery);
          emitTelegramEvent("TelegramRateLimited", { delivery, retryAfterSeconds: retryAfter }, delivery.correlationId);
          lastResult = { ok: false, delivery, telegramMessageId: null, retryAfterSeconds: retryAfter, errorCode: "rate_limited", errorMessage: "Telegram rate limited the request" };
          await sleep(Math.min(retryAfter * 1000, 5_000));
          continue;
        }
        if (!response.ok) {
          const errorBody = await safeText(response);
          lastResult = await this.fail(delivery, `telegram_${response.status}`, String(redactTelegramSecrets(errorBody)).slice(0, 240));
          if (response.status >= 400 && response.status < 500) break;
          await sleep(backoff(attempt));
          continue;
        }
        const json = await response.json().catch(() => ({}));
        const messageId = extractMessageId(json);
        delivery.status = "sent";
        delivery.messageId = messageId;
        delivery.errorCode = null;
        delivery.errorMessage = null;
        delivery.updatedAt = new Date().toISOString();
        await this.repository.updateDelivery(delivery);
        this.lastSuccessfulSendAt = delivery.updatedAt;
        this.consecutiveFailureCount = 0;
        emitTelegramEvent("TelegramMessageSent", { delivery }, delivery.correlationId);
        return { ok: true, delivery, telegramMessageId: messageId };
      } catch (error) {
        delivery.latencyMs = Date.now() - startedAt;
        lastResult = await this.fail(delivery, error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error", error instanceof Error ? error.message : "Telegram send failed");
        await sleep(backoff(attempt));
      }
    }
    return lastResult ?? this.fail(delivery, "unknown", "Telegram send failed");
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fail(delivery: TelegramDeliveryRecord, errorCode: string, errorMessage: string): Promise<TelegramSendResult> {
    delivery.status = errorCode === "rate_limited" ? "rate_limited" : "failed";
    delivery.errorCode = errorCode;
    delivery.errorMessage = String(redactTelegramSecrets(errorMessage));
    delivery.updatedAt = new Date().toISOString();
    await this.repository.updateDelivery(delivery);
    this.lastFailedSendAt = delivery.updatedAt;
    this.consecutiveFailureCount += 1;
    emitTelegramEvent("TelegramMessageFailed", { delivery }, delivery.correlationId);
    return { ok: false, delivery, telegramMessageId: null, errorCode, errorMessage: delivery.errorMessage };
  }
}

async function parseRetryAfter(response: Response) {
  const json = await response.clone().json().catch(() => null) as { parameters?: { retry_after?: number } } | null;
  const fromBody = Number(json?.parameters?.retry_after);
  const fromHeader = Number(response.headers.get("retry-after"));
  const retryAfter = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 1;
  return Math.min(Math.ceil(retryAfter), 300);
}

async function safeText(response: Response) {
  return response.text().catch(() => "");
}

function extractMessageId(value: unknown) {
  if (value && typeof value === "object") {
    const result = (value as { result?: { message_id?: number | string } }).result;
    if (result?.message_id !== undefined) return String(result.message_id);
  }
  return null;
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseIntBounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseFloatBounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function backoff(attempt: number) {
  return Math.min(250 * 2 ** (attempt - 1), 2_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const telegramClient = new TelegramClient();
