import { formatGracefulStop, formatRecovery, formatStartup } from "./formatter";
import { telegramNotificationService, type TelegramNotificationService } from "./notificationService";
import { telegramRepository, type TelegramRepository } from "./repository";
import { emitTelegramEvent } from "./events";

export class TelegramLifecycleMonitor {
  private readonly processId = `${process.pid}-${Date.now()}`;
  private readonly startedAt = new Date();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private shutdownRegistered = false;

  constructor(
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly notifications: TelegramNotificationService = telegramNotificationService,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async start() {
    const now = new Date();
    const previous = await this.repository.latestLifecycleHeartbeat().catch(() => null);
    if (previous && !previous.cleanShutdown) {
      const downtimeMs = Math.max(0, now.getTime() - new Date(previous.heartbeatAt).getTime());
      await this.notifications.sendOperations("lifecycle", formatRecovery({
        previousHeartbeat: previous.heartbeatAt,
        recoveryTime: now.toISOString(),
        downtime: formatDuration(downtimeMs),
        currentHealth: "running",
      }));
      emitTelegramEvent("ApplicationRecovered", { previousHeartbeat: previous.heartbeatAt, recoveryTime: now.toISOString() });
    }
    await this.repository.saveLifecycleState({ processId: this.processId, heartbeatAt: now.toISOString(), cleanShutdown: false, startedAt: this.startedAt.toISOString() });
    await this.notifications.sendOperations("lifecycle", formatStartup({
      environment: this.env.NODE_ENV || "production",
      version: process.env.npm_package_version || "1.0.0",
      startedAt: now.toISOString(),
    }));
    emitTelegramEvent("ApplicationStarted", { processId: this.processId, liveExecutionBlocked: true });
    this.heartbeatTimer = setInterval(() => void this.recordHeartbeat(), 30_000);
    this.heartbeatTimer.unref?.();
    this.registerShutdownHandlers();
  }

  async recordHeartbeat() {
    const heartbeatAt = new Date().toISOString();
    await this.repository.saveLifecycleState({ processId: this.processId, heartbeatAt, cleanShutdown: false, startedAt: this.startedAt.toISOString() });
    emitTelegramEvent("ApplicationHeartbeatRecorded", { processId: this.processId, heartbeatAt });
  }

  async stop(reason = "graceful shutdown") {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const stoppedAt = new Date();
    await this.repository.saveLifecycleState({
      processId: this.processId,
      heartbeatAt: stoppedAt.toISOString(),
      cleanShutdown: true,
      startedAt: this.startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
    });
    await this.notifications.sendOperations("lifecycle", formatGracefulStop({
      reason,
      uptime: formatDuration(stoppedAt.getTime() - this.startedAt.getTime()),
      stoppedAt: stoppedAt.toISOString(),
    }));
    emitTelegramEvent("ApplicationStopping", { processId: this.processId, reason });
  }

  private registerShutdownHandlers() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        void this.stop("graceful shutdown").finally(() => process.exit(0));
      });
    }
    process.on("uncaughtException", (error) => {
      emitTelegramEvent("ApplicationStopping", { reason: "uncaught exception", error: error.message });
      void this.notifications.sendOperations("lifecycle", `🔴 FinCoach crash reported\nReason: uncaught exception\nLive execution: blocked\nTimestamp: ${new Date().toISOString()}`);
    });
    process.on("unhandledRejection", (reason) => {
      emitTelegramEvent("ApplicationStopping", { reason: "unhandled rejection", error: reason instanceof Error ? reason.message : String(reason) });
      void this.notifications.sendOperations("lifecycle", `🔴 FinCoach rejection reported\nReason: unhandled rejection\nLive execution: blocked\nTimestamp: ${new Date().toISOString()}`);
    });
  }
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}h ${minutes}m ${rest}s`;
}

export const telegramLifecycleMonitor = new TelegramLifecycleMonitor();
