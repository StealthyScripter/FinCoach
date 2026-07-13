import { telegramNotificationService } from "./notificationService";
import { telegramMarketSessionMonitor } from "./marketSessionMonitor";
import { telegramReportingService } from "./reportingService";
import { telegramSignalPublisher } from "./signalPublisher";
import { loadTelegramConfig } from "./telegramClient";
import { createSchedulerRun, telegramRepository, type TelegramRepository } from "./repository";
import { telegramMetrics } from "./metrics";
import { redactTelegramSecrets } from "./formatter";
import type { ClassifiedError, ErrorClass, KnownSkipReason } from "./contracts";

const runningJobs = new Set<string>();

type SchedulerDependencies = {
  repository?: TelegramRepository;
  notifications?: typeof telegramNotificationService;
  marketSessionMonitor?: typeof telegramMarketSessionMonitor;
  reporting?: typeof telegramReportingService;
  signalPublisher?: typeof telegramSignalPublisher;
};

export type SchedulerJobResult<T> =
  | { ok: true; status: "completed"; result: T }
  | { ok: true; status: "skipped"; reason: KnownSkipReason }
  | { ok: false; status: "failed"; error: ClassifiedError };

export class TelegramScheduler {
  private timers: NodeJS.Timeout[] = [];
  private started = false;

  constructor(
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly dependencies: SchedulerDependencies = {},
  ) {}

  start() {
    if (this.started) return { started: false, reason: "already started" };
    this.started = true;
    const marketSessionMonitor = this.dependencies.marketSessionMonitor ?? telegramMarketSessionMonitor;
    this.scheduleJob("market-session-alerts", 60_000, () => marketSessionMonitor.check());
    this.scheduleJob("daily-summary", 15 * 60_000, () => this.maybeDailySummary());
    this.scheduleJob("weekly-summary", 30 * 60_000, () => this.maybeWeeklySummary());
    this.scheduleJob("signal-expiry", 60_000, () => this.expireSignals());
    for (const timer of this.timers) timer.unref?.();
    return { started: true, warning: "Process-local scheduling is used. Multi-instance deployments require PostgreSQL advisory locks or leases." };
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.started = false;
  }

  private scheduleJob<T>(name: string, intervalMs: number, fn: () => Promise<T> | T) {
    const timer = setInterval(() => {
      this.runJob(name, fn).catch((error) => {
        console.error(`Telegram scheduler job ${name} escaped containment`, error);
      });
    }, intervalMs);
    this.timers.push(timer);
  }

  async runJob<T>(name: string, fn: () => Promise<T> | T): Promise<SchedulerJobResult<T>> {
    let runId: string | null = null;
    let acquired = false;
    try {
      if (runningJobs.has(name)) {
        const skipped = createSchedulerRun(name, { reason: "already_running" });
        skipped.status = "skipped";
        skipped.completedAt = new Date().toISOString();
        try {
          await this.repository.saveSchedulerRun(skipped);
        } catch (error) {
          telegramMetrics.recordSchedulerPersistenceFailure(error);
          console.error("Telegram scheduler failed to persist skipped job", error);
        }
        telegramMetrics.recordSchedulerJob("skipped");
        return { ok: true, status: "skipped", reason: "already_running" };
      }
      runningJobs.add(name);
      acquired = true;
      const run = createSchedulerRun(name);
      runId = run.id;
      try {
        await this.repository.saveSchedulerRun(run);
      } catch (error) {
        telegramMetrics.recordSchedulerPersistenceFailure(error);
        throw error;
      }
      const result = await fn();
      const skipReason = classifySkipResult(result);
      if (skipReason) {
        await this.repository.completeSchedulerRun(run.id, "skipped", { reason: skipReason, result });
        telegramMetrics.recordSchedulerJob("skipped");
        return { ok: true, status: "skipped", reason: skipReason };
      }
      try {
        await this.repository.completeSchedulerRun(run.id, "completed", { result });
      } catch (error) {
        telegramMetrics.recordSchedulerPersistenceFailure(error);
        throw error;
      }
      telegramMetrics.recordSchedulerJob("completed");
      return { ok: true, status: "completed", result };
    } catch (error) {
      const classified = classifySchedulerError(error);
      if (runId) {
        try {
          await this.repository.completeSchedulerRun(runId, "failed", { error: classified });
        } catch (persistenceError) {
          telegramMetrics.recordSchedulerPersistenceFailure(persistenceError);
          console.error("Telegram scheduler failed to persist job failure", persistenceError);
        }
      }
      console.error(`Telegram scheduler job ${name} failed`, error);
      telegramMetrics.recordSchedulerJob("failed", classified.message);
      return { ok: false, status: "failed", error: classified };
    } finally {
      if (acquired) runningJobs.delete(name);
    }
  }

  private async maybeDailySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCHours() !== config.dailySummaryHourUtc) return { sent: false, reason: "outside_window" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const result = await reporting.dailySummaryResult(now);
    if (result.status === "existing" && result.summary.deliveryId) {
      telegramMetrics.recordSummarySend("daily", "automatic", false);
      return { sent: false, reason: "summary_already_delivered", summaryId: result.summary.id, status: "already_sent" };
    }
    const delivery = await notifications.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "daily", automatic: true });
    if (delivery.sent && "result" in delivery) await reporting.markDelivered(result.summary.id, delivery.result.delivery.id);
    telegramMetrics.recordSummarySend("daily", "automatic", delivery.sent);
    return { ...delivery, summaryId: result.summary.id, status: result.status };
  }

  private async maybeWeeklySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCDay() !== config.weeklySummaryDay || now.getUTCHours() !== config.weeklySummaryHourUtc) return { sent: false, reason: "outside_window" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const result = await reporting.weeklySummaryResult(now);
    if (result.status === "existing" && result.summary.deliveryId) {
      telegramMetrics.recordSummarySend("weekly", "automatic", false);
      return { sent: false, reason: "summary_already_delivered", summaryId: result.summary.id, status: "already_sent" };
    }
    const delivery = await notifications.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "weekly", automatic: true });
    if (delivery.sent && "result" in delivery) await reporting.markDelivered(result.summary.id, delivery.result.delivery.id);
    telegramMetrics.recordSummarySend("weekly", "automatic", delivery.sent);
    return { ...delivery, summaryId: result.summary.id, status: result.status };
  }

  private async expireSignals(now = new Date()) {
    const signals = await this.repository.listSignals(500);
    const expired = [];
    const signalPublisher = this.dependencies.signalPublisher ?? telegramSignalPublisher;
    for (const signal of signals) {
      if (signal.status === "published" && new Date(signal.expiresAt).getTime() <= now.getTime()) {
        expired.push(await signalPublisher.lifecycleUpdate({
          signalId: signal.signalId,
          outcome: "expired",
          message: "Signal expired before demo entry tracking triggered.",
          resultR: null,
          demoPnl: null,
          lesson: "Expired signals remain auditable and are not actionable.",
        }));
      }
    }
    return { expired: expired.length };
  }
}

function classifySkipResult(result: unknown): KnownSkipReason | null {
  if (!result || typeof result !== "object") return null;
  const value = result as Record<string, unknown>;
  if (value.reason === "outside_window") return "outside_window";
  if (value.reason === "summary_already_delivered") return "summary_already_delivered";
  if (value.status === "existing" && value.sent === false) return "summary_already_exists";
  if (value.expired === 0) return "no_work";
  if (Array.isArray(result) && result.length === 0) return "no_work";
  return null;
}

export function classifySchedulerError(error: unknown): ClassifiedError {
  const type = error instanceof Error ? error.name || "Error" : typeof error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = String(redactTelegramSecrets(raw));
  return { class: classifyErrorClass(error, message), type, message };
}

function classifyErrorClass(error: unknown, message: string): ErrorClass {
  const lowered = message.toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || lowered.includes("typeerror") || lowered.includes("referenceerror")) return "programming";
  if (lowered.includes("invariant")) return "invariant";
  if (lowered.includes("demo-only") || lowered.includes("live execution") || lowered.includes("unauthorized") || lowered.includes("kill switch")) return "safety";
  if (lowered.includes("database_url") || lowered.includes("postgres") || lowered.includes("connection") || lowered.includes("persist") || lowered.includes("record cannot be created") || code.startsWith("08")) return "persistence";
  if (lowered.includes("config")) return "configuration";
  if (lowered.includes("malformed") || lowered.includes("missing") || lowered.includes("invalid summary") || lowered.includes("unique constraint") || code === "23505") return "data_integrity";
  if (lowered.includes("telegram") || lowered.includes("delivery") || lowered.includes("rate limited") || lowered.includes("timeout")) return "delivery";
  return "unknown";
}

export const telegramScheduler = new TelegramScheduler();
