import { formatGracefulStop, formatRecovery, formatStartup, protectTelegramMessageLength, redactTelegramSecrets } from "./formatter";
import { telegramNotificationService, type TelegramNotificationService } from "./notificationService";
import { telegramRepository, type TelegramRepository } from "./repository";
import { emitTelegramEvent } from "./events";

export class TelegramLifecycleMonitor {
  private readonly processId = `${process.pid}-${Date.now()}`;
  private readonly startedAt = new Date();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private shutdownRegistered = false;
  private reportingProcessFailure = false;
  private readonly processFailureDeduplication = new Map<string, number>();

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
      this.reportUncaughtException(error);
    });
    process.on("unhandledRejection", (reason) => {
      this.reportUnhandledRejection(reason);
    });
  }

  reportUncaughtException(error: unknown) {
    this.reportProcessFailure("exception", error);
  }

  reportUnhandledRejection(reason: unknown) {
    this.reportProcessFailure("rejection", reason);
  }

  private reportProcessFailure(kind: "exception" | "rejection", reason: unknown) {
    const details = normalizeProcessFailure(reason, this.env);
    const dedupeKey = `${kind}:${details.type}:${details.message}`;
    const now = Date.now();
    const previous = this.processFailureDeduplication.get(dedupeKey);
    if (previous && now - previous < 60_000) return;
    this.processFailureDeduplication.set(dedupeKey, now);
    if (this.reportingProcessFailure) return;
    this.reportingProcessFailure = true;
    emitTelegramEvent("ApplicationStopping", { reason: `unhandled ${kind}`, error: details.message, type: details.type });
    console.error(`FinCoach process ${kind}: ${details.type}: ${details.message}`);
    const text = [
      kind === "rejection" ? "🔴 FinCoach process rejection" : "🔴 FinCoach process exception",
      `Type: ${details.type}`,
      `Message: ${details.message}`,
      "Live execution: blocked",
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      Promise.resolve(this.notifications.sendOperations("lifecycle", text))
        .catch((error) => {
          const nested = normalizeProcessFailure(error, this.env);
          console.error(`FinCoach process ${kind} alert failed: ${nested.type}: ${nested.message}`);
        })
        .finally(() => {
          this.reportingProcessFailure = false;
        });
    } catch (error) {
      const nested = normalizeProcessFailure(error, this.env);
      console.error(`FinCoach process ${kind} alert failed: ${nested.type}: ${nested.message}`);
      this.reportingProcessFailure = false;
    }
  }
}

export function normalizeProcessFailure(reason: unknown, env: NodeJS.ProcessEnv = process.env) {
  const type = reason instanceof Error ? reason.name || "Error" : typeof reason;
  const rawMessage = reason instanceof Error ? reason.message : String(reason);
  let message = String(redactTelegramSecrets(rawMessage));
  for (const value of Object.values(env)) {
    if (typeof value === "string" && value.length >= 6) {
      message = message.split(value).join("[REDACTED]");
    }
  }
  return {
    type,
    message: protectTelegramMessageLength(message || "unknown", 500),
  };
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}h ${minutes}m ${rest}s`;
}

export const telegramLifecycleMonitor = new TelegramLifecycleMonitor();
