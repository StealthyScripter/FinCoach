import type { TelegramEnvironmentConfig, TelegramNormalizedUpdate } from "./contracts";
import { telegramMetrics } from "./metrics";
import { telegramTransport, type TelegramTransport } from "./transport";
import { loadTelegramConfig } from "./telegramClient";
import { telegramUpdateCursor, type TelegramUpdateCursor } from "./updateCursor";

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

export class TelegramUpdateReceiver {
  private running = false;
  private stopped = false;
  private loop: Promise<void> | null = null;
  private inFlight: AbortController | null = null;
  private seenUpdateIds = new Set<number>();
  private shutdownRegistered = false;

  constructor(
    private readonly config: TelegramEnvironmentConfig = loadTelegramConfig(),
    private readonly cursor: TelegramUpdateCursor = telegramUpdateCursor,
    private readonly transport: TelegramTransport = telegramTransport,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  start() {
    if (this.running) return this;
    if (!this.config.notificationsEnabled || !this.config.botToken) {
      console.warn("Telegram update receiver not started: bot token or notifications are not configured");
      return this;
    }
    this.running = true;
    this.stopped = false;
    this.loop = this.pollLoop();
    void this.loop.catch((error) => {
      this.running = false;
      console.warn(`Telegram update receiver stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.registerShutdownHandlers();
    return this;
  }

  health() {
    return {
      running: this.running,
      stopped: this.stopped,
      inFlight: Boolean(this.inFlight),
      seenUpdateIds: this.seenUpdateIds.size,
    };
  }

  async stop() {
    this.stopped = true;
    this.running = false;
    this.inFlight?.abort();
    await this.loop?.catch(() => undefined);
  }

  private async pollLoop() {
    let offset = await this.cursor.loadOffset().catch((error) => {
      console.warn(`Telegram update cursor load failed; starting from latest available offset: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    });
    let attempt = 0;

    while (!this.stopped) {
      try {
        const updates = await this.getUpdates(offset);
        attempt = 0;
        if (updates.length > 0) telegramMetrics.increment("updatesReceived", updates.length);
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
          }
          await this.cursor.saveProcessed(update.update_id);
          offset = Math.max(offset, update.update_id + 1);
          this.compactSeen(update.update_id);
        }
      } catch (error) {
        if (this.stopped && isAbortError(error)) return;
        telegramMetrics.increment("updatesFailed");
        telegramMetrics.increment("pollingReconnects");
        const retryAfter = retryAfterSeconds(error);
        const delayMs = retryAfter ? retryAfter * 1000 : backoff(attempt += 1);
        console.warn(`Telegram update polling failed; retrying in ${Math.round(delayMs / 1000)}s: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(delayMs);
      }
    }
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

  private registerShutdownHandlers() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        void this.stop();
      });
    }
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
