import { telegramNotificationService } from "./notificationService";
import { telegramMarketSessionMonitor } from "./marketSessionMonitor";
import { telegramReportingService } from "./reportingService";
import { telegramSignalPublisher } from "./signalPublisher";
import { loadTelegramConfig } from "./telegramClient";
import { createSchedulerRun, telegramRepository, type TelegramRepository } from "./repository";

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
  | { ok: true; status: "skipped"; reason: string }
  | { ok: false; status: "failed"; error: string };

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
        const skipped = createSchedulerRun(name, { reason: "job already running" });
        skipped.status = "skipped";
        skipped.completedAt = new Date().toISOString();
        await this.repository.saveSchedulerRun(skipped);
        return { ok: true, status: "skipped", reason: "job already running" };
      }
      runningJobs.add(name);
      acquired = true;
      const run = createSchedulerRun(name);
      runId = run.id;
      await this.repository.saveSchedulerRun(run);
      const result = await fn();
      await this.repository.completeSchedulerRun(run.id, "completed", { result });
      return { ok: true, status: "completed", result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runId) {
        try {
          await this.repository.completeSchedulerRun(runId, "failed", { error: message });
        } catch (persistenceError) {
          console.error("Telegram scheduler failed to persist job failure", persistenceError);
        }
      }
      console.error(`Telegram scheduler job ${name} failed`, error);
      return { ok: false, status: "failed", error: message };
    } finally {
      if (acquired) runningJobs.delete(name);
    }
  }

  private async maybeDailySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCHours() !== config.dailySummaryHourUtc) return { sent: false, reason: "outside configured hour" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const result = await reporting.dailySummaryResult(now);
    if (result.status === "existing" && result.summary.deliveryId) return { sent: false, reason: "daily summary already sent", summaryId: result.summary.id, status: "already_sent" };
    const delivery = await notifications.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "daily", automatic: true });
    if (delivery.sent && "result" in delivery) await reporting.markDelivered(result.summary.id, delivery.result.delivery.id);
    return { ...delivery, summaryId: result.summary.id, status: result.status };
  }

  private async maybeWeeklySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCDay() !== config.weeklySummaryDay || now.getUTCHours() !== config.weeklySummaryHourUtc) return { sent: false, reason: "outside configured weekly window" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const result = await reporting.weeklySummaryResult(now);
    if (result.status === "existing" && result.summary.deliveryId) return { sent: false, reason: "weekly summary already sent", summaryId: result.summary.id, status: "already_sent" };
    const delivery = await notifications.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "weekly", automatic: true });
    if (delivery.sent && "result" in delivery) await reporting.markDelivered(result.summary.id, delivery.result.delivery.id);
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

export const telegramScheduler = new TelegramScheduler();
