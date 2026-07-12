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
    this.timers.push(setInterval(() => void this.runJob("market-session-alerts", () => marketSessionMonitor.check()), 60_000));
    this.timers.push(setInterval(() => void this.runJob("daily-summary", () => this.maybeDailySummary()), 15 * 60_000));
    this.timers.push(setInterval(() => void this.runJob("weekly-summary", () => this.maybeWeeklySummary()), 30 * 60_000));
    this.timers.push(setInterval(() => void this.runJob("signal-expiry", () => this.expireSignals()), 60_000));
    for (const timer of this.timers) timer.unref?.();
    return { started: true, warning: "Process-local scheduling is used. Multi-instance deployments require PostgreSQL advisory locks or leases." };
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.started = false;
  }

  async runJob<T>(name: string, fn: () => Promise<T> | T) {
    if (runningJobs.has(name)) return { skipped: true, reason: "job already running" };
    runningJobs.add(name);
    const run = createSchedulerRun(name);
    await this.repository.saveSchedulerRun(run);
    try {
      const result = await fn();
      await this.repository.completeSchedulerRun(run.id, "completed", { result });
      return result;
    } catch (error) {
      await this.repository.completeSchedulerRun(run.id, "failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      runningJobs.delete(name);
    }
  }

  private async maybeDailySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCHours() !== config.dailySummaryHourUtc) return { sent: false, reason: "outside configured hour" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const summary = await reporting.dailySummary(now);
    return notifications.sendOperations("report", summary.conciseMessage, { summaryId: summary.id, period: "daily" });
  }

  private async maybeWeeklySummary(now = new Date()) {
    const config = loadTelegramConfig();
    if (now.getUTCDay() !== config.weeklySummaryDay || now.getUTCHours() !== config.weeklySummaryHourUtc) return { sent: false, reason: "outside configured weekly window" };
    const reporting = this.dependencies.reporting ?? telegramReportingService;
    const notifications = this.dependencies.notifications ?? telegramNotificationService;
    const summary = await reporting.weeklySummary(now);
    return notifications.sendOperations("report", summary.conciseMessage, { summaryId: summary.id, period: "weekly" });
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
