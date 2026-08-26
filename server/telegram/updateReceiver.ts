import { createHash } from "crypto";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import type { TelegramEnvironmentConfig, TelegramNormalizedUpdate } from "./contracts";
import { telegramMetrics } from "./metrics";
import { telegramTransport, type TelegramTransport } from "./transport";
import { loadTelegramConfig } from "./telegramClient";
import { telegramUpdateCursor, type TelegramUpdateCursor } from "./updateCursor";
import { structuredLogger } from "../structuredLogger";
import { operationalBlockerService } from "../operationalBlockerService";

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
const EMPTY_POLL_YIELD_MS = 250;
const DEFAULT_LOCK_PATH = join("/tmp", "fincoach-telegram-getupdates.lock");

export type TelegramPollingLeadership = {
  kind: "postgres" | "filesystem";
  release(): Promise<void>;
};

export interface TelegramPollingCoordinator {
  tryAcquire(botToken: string): Promise<{ acquired: true; leadership: TelegramPollingLeadership } | { acquired: false; reason: string; kind: "postgres" | "filesystem" }>;
}

export class TelegramUpdateReceiver {
  private running = false;
  private stopped = false;
  private loop: Promise<void> | null = null;
  private inFlight: AbortController | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private resolveRetrySleep: (() => void) | null = null;
  private seenUpdateIds = new Set<number>();
  private lastPollSuccessAt: string | null = null;
  private lastPollFailureAt: string | null = null;
  private consecutivePollFailures = 0;
  private lastPollError: string | null = null;
  private lockPath: string | null = null;
  private ownershipState: "unclaimed" | "claiming" | "owned" | "standby" | "blocked" | "conflict" = "unclaimed";
  private leadershipKind: "postgres" | "filesystem" | null = null;
  private leadership: TelegramPollingLeadership | null = null;
  private lastCommandReceivedAt: string | null = null;
  private lastCommandProcessedAt: string | null = null;
  private lastReplySentAt: string | null = null;

  constructor(
    private readonly config: TelegramEnvironmentConfig = loadTelegramConfig(),
    private readonly cursor: TelegramUpdateCursor = telegramUpdateCursor,
    private readonly transport: TelegramTransport = telegramTransport,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly coordinator: TelegramPollingCoordinator = createTelegramPollingCoordinator(),
  ) {}

  start() {
    if (this.running) return this;
    const decision = commandPollingStartDecision(this.config);
    telegramMetrics.recordCommandPollerStartDecision(decision);
    structuredLogger.telegram({
      level: "info",
      event: "telegram_command_poller_start_decision",
      message: "Telegram command poller start decision evaluated",
      ...decision,
    });
    if (!decision.started) {
      this.ownershipState = "blocked";
      this.lastPollError = decision.reason;
      structuredLogger.telegram({ level: "info", event: "telegram_command_polling_not_started", message: "Telegram command polling not started", ...decision });
      return this;
    }
    if (!this.config.notificationsEnabled || !this.config.botToken) {
      console.warn("Telegram update receiver not started: bot token or notifications are not configured");
      structuredLogger.telegram({ level: "warn", event: "telegram_update_receiver_not_started", message: "Telegram update receiver not started", reason: "bot_token_or_notifications_not_configured" });
      return this;
    }
    this.ownershipState = "claiming";
    void this.acquireLeadershipAndPoll().catch((error) => {
      this.running = false;
      this.stopped = true;
      this.ownershipState = "blocked";
      this.lastPollError = error instanceof Error ? error.message : String(error);
      structuredLogger.telegram({ level: "error", event: "telegram_polling_leadership_failed", message: "Telegram polling leadership check failed", error });
    });
    return this;
  }

  private async acquireLeadershipAndPoll() {
    const lock = await this.coordinator.tryAcquire(this.config.botToken!);
    if (!lock.acquired) {
      this.leadershipKind = lock.kind;
      this.running = false;
      this.stopped = false;
      this.ownershipState = "blocked";
      this.lastPollError = lock.reason;
      if (lock.reason === "telegram_polling_leader_exists") this.ownershipState = "standby";
      structuredLogger.telegram({ level: "warn", event: "telegram_update_receiver_standby", message: "Telegram update receiver not started because another owner holds getUpdates polling", reason: lock.reason, leadershipKind: lock.kind });
      return;
    }
    this.leadership = lock.leadership;
    this.leadershipKind = lock.leadership.kind;
    if (lock.leadership.kind === "filesystem") this.lockPath = process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH ?? DEFAULT_LOCK_PATH;
    this.ownershipState = "owned";
    this.running = true;
    this.stopped = false;
    structuredLogger.telegram({ level: "info", event: "telegram_update_receiver_started", message: "Telegram update receiver started", leadershipKind: lock.leadership.kind });
    this.loop = this.pollLoop();
    void this.loop.catch((error) => {
      this.running = false;
      console.warn(`Telegram update receiver stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      structuredLogger.telegram({ level: "error", event: "telegram_update_receiver_stopped_unexpectedly", message: "Telegram update receiver stopped unexpectedly", error });
    });
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
      leadershipKind: this.leadershipKind,
      lockPath: this.lockPath,
      commandPollingEnabled: this.config.commandPollingEnabled,
      inboundPollingEnabled: this.config.inboundPollingEnabled,
      longPollingEnabled: this.config.longPollingEnabled,
      transport: this.config.transport,
      lastCommandReceivedAt: this.lastCommandReceivedAt,
      lastCommandProcessedAt: this.lastCommandProcessedAt,
      lastReplySentAt: this.lastReplySentAt,
    };
  }

  async stop() {
    this.stopped = true;
    this.running = false;
    this.inFlight?.abort();
    this.resolveRetrySleep?.();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.loop?.catch(() => undefined);
    await this.releaseLock();
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
        if (this.ownershipState === "conflict") this.ownershipState = "owned";
          await operationalBlockerService.resolve({
            kind: "dependency",
            code: "telegram_getupdates_conflict",
            scope: { component: "telegram-getupdates" },
            expected: false,
            dedupeKey: "telegram:getupdates:ownership_conflict",
          }).catch(() => undefined);
        if (updates.length > 0) telegramMetrics.increment("updatesReceived", updates.length);
        if (updates.length > 0) structuredLogger.telegram({ level: "info", event: "telegram_update_received", message: "Telegram updates received", updateCount: updates.length, offset });
        if (updates.length === 0) await this.sleep(EMPTY_POLL_YIELD_MS);
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
            this.lastCommandReceivedAt = normalized.receivedAt;
            telegramMetrics.recordCommandReceived(normalized.receivedAt);
            const result = await this.transport.handle(normalized);
            if (result?.processed) {
              this.lastCommandProcessedAt = new Date().toISOString();
              telegramMetrics.recordCommandProcessed(this.lastCommandProcessedAt);
            }
            if (result?.processed && "replied" in result && result.replied) {
              this.lastReplySentAt = new Date().toISOString();
              telegramMetrics.recordReplySent(this.lastReplySentAt);
            }
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
          telegramMetrics.increment("pollingConflicts");
          this.lastPollFailureAt = new Date().toISOString();
          this.consecutivePollFailures += 1;
          this.lastPollError = error.message;
          this.ownershipState = "conflict";
          this.running = false;
          this.stopped = true;
          await this.releaseLock();
          structuredLogger.telegram({ level: "error", event: "telegram_polling_conflict", message: "Telegram getUpdates polling conflict; receiver stopped to avoid duplicate long polling", error });
          await operationalBlockerService.record({
            kind: "dependency",
            code: "telegram_getupdates_conflict",
            title: "Telegram getUpdates ownership conflict",
            whatBlocked: "Telegram inbound command polling",
            reason: "Telegram Bot API returned HTTP 409, which means another consumer owns getUpdates for this bot.",
            currentValue: "conflict",
            limitValue: "single getUpdates owner",
            scope: { component: "telegram-getupdates" },
            expected: false,
            action: "Stop the competing poller or move FinCoach to webhook transport.",
            effect: "Inbound Telegram commands such as /status are unavailable until ownership is restored. Outbound alerts may still work.",
            severity: "warning",
            alertCategory: "PROVIDER_FAILURE",
            operatorActionable: true,
            telegramAlert: true,
            dedupeKey: "telegram:getupdates:ownership_conflict",
          }).catch(() => undefined);
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
        await this.sleep(delayMs);
      }
    }
  }

  private reachabilityState(): "available" | "degraded" | "unavailable" | "unknown" {
    if (!commandPollingStartDecision(this.config).started || !this.config.botToken || !this.config.notificationsEnabled) return "unavailable";
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

  private sleep(ms: number) {
    if (this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolveRetrySleep = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.resolveRetrySleep = null;
        resolve();
      }, ms);
      this.retryTimer.unref();
    });
  }

  private async releaseLock() {
    await this.leadership?.release().catch((error) => {
      structuredLogger.telegram({ level: "warn", event: "telegram_polling_leadership_release_failed", message: "Telegram polling leadership release failed", error });
    });
    this.leadership = null;
    if (this.ownershipState === "owned") this.ownershipState = "unclaimed";
  }
}

export function commandPollingStartDecision(config: TelegramEnvironmentConfig) {
  if (!config.commandPollingEnabled) return startDecision(config, false, "fincoach_telegram_command_polling_disabled");
  if (!config.inboundPollingEnabled) return startDecision(config, false, "fincoach_telegram_inbound_polling_disabled");
  if (!config.longPollingEnabled) return startDecision(config, false, "fincoach_telegram_long_polling_disabled");
  if (config.transport !== "long_polling") return startDecision(config, false, "fincoach_telegram_transport_not_long_polling");
  return startDecision(config, true, "all_gates_enabled");
}

function startDecision(config: TelegramEnvironmentConfig, started: boolean, reason: string) {
  return {
    started,
    reason,
    commandPollingEnabled: config.commandPollingEnabled,
    inboundPollingEnabled: config.inboundPollingEnabled,
    longPollingEnabled: config.longPollingEnabled,
    transport: config.transport,
  };
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

function createTelegramPollingCoordinator(databaseUrl = process.env.DATABASE_URL): TelegramPollingCoordinator {
  if (databaseUrl) return new PgTelegramPollingCoordinator(databaseUrl);
  return new FilesystemTelegramPollingCoordinator(process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH ?? DEFAULT_LOCK_PATH);
}

class FilesystemTelegramPollingCoordinator implements TelegramPollingCoordinator {
  constructor(private readonly path: string) {}

  async tryAcquire(_botToken: string) {
    const lock = acquirePollingLock(this.path);
    if (!lock.acquired) return { acquired: false as const, reason: lock.reason, kind: "filesystem" as const };
    return {
      acquired: true as const,
      leadership: {
        kind: "filesystem" as const,
        release: async () => releasePollingLock(lock.path),
      },
    };
  }
}

class PgTelegramPollingCoordinator implements TelegramPollingCoordinator {
  constructor(private readonly databaseUrl: string) {}

  async tryAcquire(botToken: string) {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      const [key1, key2] = advisoryLockKeys(`fincoach:telegram:getupdates:${tokenFingerprint(botToken)}`);
      const result = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [key1, key2]);
      if (result.rows[0]?.acquired !== true) {
        await client.end();
        return { acquired: false as const, reason: "telegram_polling_leader_exists", kind: "postgres" as const };
      }
      return {
        acquired: true as const,
        leadership: {
          kind: "postgres" as const,
          release: async () => {
            await client.query("SELECT pg_advisory_unlock($1, $2)", [key1, key2]).catch(() => undefined);
            await client.end();
          },
        },
      };
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
  }
}

function tokenFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function advisoryLockKeys(value: string): [number, number] {
  const hash = createHash("sha256").update(value).digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
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

export const telegramUpdateReceiver = new TelegramUpdateReceiver();
