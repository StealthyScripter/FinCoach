import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import type { TelegramEnvironmentConfig, TelegramNormalizedUpdate } from "./contracts";
import { telegramMetrics } from "./metrics";
import { telegramTransport, type TelegramTransport } from "./transport";
import { loadTelegramConfig } from "./telegramClient";
import { telegramUpdateCursor, type TelegramUpdateCursor } from "./updateCursor";
import { structuredLogger } from "../structuredLogger";

type TelegramApiUpdate = {
  update_id: number;
  message?: TelegramApiMessage;
  edited_message?: TelegramApiMessage;
};

type TelegramApiMessage = {
  message_id: number | string;
  date?: number;
  text?: string;
  chat?: { id?: number | string };
  from?: { id?: number | string };
};

const LONG_POLL_TIMEOUT_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_LOCK_PATH = join("/tmp", "fincoach-telegram-getupdates.lock");

export class TelegramUpdateReceiver {
  private running = false;
  private stopped = false;
  private loop: Promise<void> | null = null;
  private inFlight: AbortController | null = null;
  private seenUpdateIds = new Set<number>();
  private lastPollSuccessAt: string | null = null;
  private lastPollFailureAt: string | null = null;
  private consecutivePollFailures = 0;
  private lastPollError: string | null = null;
  private lockPath: string | null = null;
  private ownershipState: "unclaimed" | "owned" | "blocked" | "conflict" = "unclaimed";

  constructor(
    private readonly config: TelegramEnvironmentConfig = loadTelegramConfig(),
    private readonly cursor: TelegramUpdateCursor = telegramUpdateCursor,
    private readonly transport: TelegramTransport = telegramTransport,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  start() {
    if (this.running) return this;
    if (!this.config.inboundPollingEnabled) {
      this.ownershipState = "blocked";
      this.lastPollError = "telegram_inbound_polling_disabled";
      structuredLogger.telegram({ level: "info", event: "telegram_update_receiver_not_started", message: "Telegram update receiver not started", reason: "telegram_inbound_polling_disabled" });
      return this;
    }
    if (!this.config.notificationsEnabled || !this.config.botToken) {
      console.warn("Telegram update receiver not started: bot token or notifications are not configured");
      structuredLogger.telegram({ level: "warn", event: "telegram_update_receiver_not_started", message: "Telegram update receiver not started", reason: "bot_token_or_notifications_not_configured" });
      return this;
    }
    const lock = acquirePollingLock(process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH ?? DEFAULT_LOCK_PATH);
    this.lockPath = lock.path;
    if (!lock.acquired) {
      this.ownershipState = "blocked";
      this.lastPollError = lock.reason;
      structuredLogger.telegram({ level: "error", event: "telegram_update_receiver_ownership_blocked", message: "Telegram update receiver not started because another local owner holds getUpdates polling", reason: lock.reason, lockPath: lock.path });
      return this;
    }
    this.ownershipState = "owned";
    this.running = true;
    this.stopped = false;
    structuredLogger.telegram({ level: "info", event: "telegram_update_receiver_started", message: "Telegram update receiver started" });
    this.loop = this.pollLoop();
    void this.loop.catch((error) => {
      this.running = false;
      console.warn(`Telegram update receiver stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      structuredLogger.telegram({ level: "error", event: "telegram_update_receiver_stopped_unexpectedly", message: "Telegram update receiver stopped unexpectedly", error });
    });
    return this;
  }

  health() {
    return {
      running: this.running,
      stopped: this.stopped,
      inFlight: Boolean(this.inFlight),
      seenUpdateIds: this.seenUpdateIds.size,
      lastPollSuccessAt: this.lastPollSuccessAt,
      lastPollFailureAt: this.lastPollFailureAt,
      consecutivePollFailures: this.consecutivePollFailures,
      lastPollError: this.lastPollError,
      reachabilityState: this.reachabilityState(),
      ownershipState: this.ownershipState,
      lockPath: this.lockPath,
    };
  }

  async stop() {
    this.stopped = true;
    this.running = false;
    this.inFlight?.abort();
    await this.loop?.catch(() => undefined);
    this.releaseLock();
    structuredLogger.telegram({ level: "info", event: "telegram_update_receiver_stopped", message: "Telegram update receiver stopped" });
  }

  private async pollLoop() {
    let offset = await this.cursor.loadOffset().catch((error) => {
      console.warn(`Telegram update cursor load failed; starting from latest available offset: ${error instanceof Error ? error.message : String(error)}`);
      structuredLogger.telegram({ level: "error", event: "telegram_update_cursor_load_failed", message: "Telegram update cursor load failed", error });
      return 0;
    });
    let attempt = 0;

    while (!this.stopped) {
      try {
        const updates = await this.getUpdates(offset);
        attempt = 0;
        this.lastPollSuccessAt = new Date().toISOString();
        this.consecutivePollFailures = 0;
        this.lastPollError = null;
        if (updates.length > 0) telegramMetrics.increment("updatesReceived", updates.length);
        if (updates.length > 0) structuredLogger.telegram({ level: "info", event: "telegram_updates_received", message: "Telegram updates received", updateCount: updates.length, offset });
        for (const update of updates) {
          if (this.stopped) break;
          if (this.seenUpdateIds.has(update.update_id)) {
            telegramMetrics.increment("updatesIgnored");
            offset = Math.max(offset, update.update_id + 1);
            continue;
          }
          this.seenUpdateIds.add(update.update_id);
          const normalized = normalizeUpdate(update);
          if (normalized) {
            await this.transport.handle(normalized);
          } else {
            telegramMetrics.increment("updatesIgnored");
            structuredLogger.telegram({ level: "info", event: "telegram_update_ignored", message: "Telegram update ignored", updateId: update.update_id, reason: "not_normalizable" });
          }
          await this.cursor.saveProcessed(update.update_id);
          offset = Math.max(offset, update.update_id + 1);
          this.compactSeen(update.update_id);
        }
      } catch (error) {
        if (this.stopped && isAbortError(error)) return;
        if (error instanceof TelegramPollingConflictError) {
          telegramMetrics.increment("updatesFailed");
          this.lastPollFailureAt = new Date().toISOString();
          this.consecutivePollFailures += 1;
          this.lastPollError = error.message;
          this.ownershipState = "conflict";
          this.running = false;
          this.stopped = true;
          this.releaseLock();
          structuredLogger.telegram({ level: "error", event: "telegram_polling_conflict", message: "Telegram getUpdates polling conflict; receiver stopped to avoid duplicate long polling", error });
          return;
        }
        telegramMetrics.increment("updatesFailed");
        telegramMetrics.increment("pollingReconnects");
        const retryAfter = retryAfterSeconds(error);
        const delayMs = retryAfter ? retryAfter * 1000 : backoff(attempt += 1);
        this.lastPollFailureAt = new Date().toISOString();
        this.consecutivePollFailures += 1;
        this.lastPollError = error instanceof Error ? error.message : String(error);
        console.warn(`Telegram update polling failed; retrying in ${Math.round(delayMs / 1000)}s: ${error instanceof Error ? error.message : String(error)}`);
        structuredLogger.telegram({ level: "error", event: "telegram_polling_failed", message: "Telegram update polling failed", retryAttempt: attempt, nextRetryAt: new Date(Date.now() + delayMs).toISOString(), retryDelayMs: delayMs, error });
        await sleep(delayMs);
      }
    }
  }

  private reachabilityState(): "available" | "degraded" | "unavailable" | "unknown" {
    if (!this.config.inboundPollingEnabled || !this.config.botToken || !this.config.notificationsEnabled) return "unavailable";
    if (!this.lastPollSuccessAt && !this.lastPollFailureAt) return "unknown";
    if (this.consecutivePollFailures >= 3) return "unavailable";
    if (this.consecutivePollFailures > 0) return "degraded";
    return "available";
  }

  private async getUpdates(offset: number) {
    if (!this.config.botToken) return [];
    this.inFlight = new AbortController();
    const timeout = setTimeout(() => this.inFlight?.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.config.botToken}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset,
          timeout: LONG_POLL_TIMEOUT_SECONDS,
          allowed_updates: ["message", "edited_message"],
        }),
        signal: this.inFlight.signal,
      });
      if (response.status === 409) throw new TelegramPollingConflictError("Telegram getUpdates failed with HTTP 409; another bot update consumer is active");
      if (response.status === 429) throw new TelegramPollingError("Telegram rate limited getUpdates", await parseRetryAfter(response));
      if (!response.ok) throw new Error(`Telegram getUpdates failed with HTTP ${response.status}`);
      const json = await response.json().catch(() => ({})) as { ok?: boolean; result?: TelegramApiUpdate[]; description?: string; parameters?: { retry_after?: number } };
      if (!json.ok) throw new TelegramPollingError(json.description || "Telegram getUpdates returned ok=false", json.parameters?.retry_after);
      return Array.isArray(json.result) ? json.result : [];
    } finally {
      clearTimeout(timeout);
      this.inFlight = null;
    }
  }

  private compactSeen(updateId: number) {
    if (this.seenUpdateIds.size < 1_000) return;
    for (const seen of this.seenUpdateIds) {
      if (seen < updateId - 500) this.seenUpdateIds.delete(seen);
    }
  }

  private releaseLock() {
    if (this.lockPath && this.ownershipState !== "blocked") releasePollingLock(this.lockPath);
    if (this.ownershipState === "owned") this.ownershipState = "unclaimed";
  }
}

function normalizeUpdate(update: TelegramApiUpdate): TelegramNormalizedUpdate | null {
  const message = update.message ?? update.edited_message;
  if (!message?.text || message.chat?.id === undefined || message.from?.id === undefined || message.message_id === undefined) return null;
  return {
    source: "telegram",
    updateId: update.update_id,
    chatId: String(message.chat.id),
    actorId: String(message.from.id),
    messageId: String(message.message_id),
    text: message.text,
    receivedAt: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
  };
}

async function parseRetryAfter(response: Response) {
  const json = await response.clone().json().catch(() => null) as { parameters?: { retry_after?: number } } | null;
  const header = Number(response.headers.get("retry-after"));
  const body = Number(json?.parameters?.retry_after);
  const retryAfter = Number.isFinite(body) && body > 0 ? body : Number.isFinite(header) && header > 0 ? header : 1;
  return Math.min(Math.ceil(retryAfter), 300);
}

class TelegramPollingError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

class TelegramPollingConflictError extends Error {}

function acquirePollingLock(path: string): { acquired: true; path: string } | { acquired: false; path: string; reason: string } {
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, payload);
    closeSync(fd);
    return { acquired: true, path };
  } catch {
    if (isStaleLock(path)) {
      try {
        unlinkSync(path);
        const fd = openSync(path, "wx");
        writeFileSync(fd, payload);
        closeSync(fd);
        return { acquired: true, path };
      } catch {
        return { acquired: false, path, reason: "telegram_poll_lock_race_lost" };
      }
    }
    return { acquired: false, path, reason: "telegram_poll_lock_held" };
  }
}

function releasePollingLock(path: string) {
  try {
    const raw = readFileSync(path, "utf8");
    const pid = Number((JSON.parse(raw) as { pid?: unknown }).pid);
    if (pid === process.pid) unlinkSync(path);
  } catch {
    return;
  }
}

function isStaleLock(path: string) {
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf8");
    const pid = Number((JSON.parse(raw) as { pid?: unknown }).pid);
    if (!Number.isInteger(pid) || pid <= 0) return true;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" || (error instanceof SyntaxError);
  }
}

function retryAfterSeconds(error: unknown) {
  return error instanceof TelegramPollingError && error.retryAfterSeconds ? Math.min(error.retryAfterSeconds, 300) : null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function backoff(attempt: number) {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const telegramUpdateReceiver = new TelegramUpdateReceiver();
