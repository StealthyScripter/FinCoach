import { randomUUID } from "crypto";
import { formatApplicationOffline, formatApplicationOnline, formatRecovery, protectTelegramMessageLength, redactTelegramSecrets } from "./formatter";
import { telegramNotificationService, type TelegramNotificationService } from "./notificationService";
import { telegramRepository, type TelegramRepository } from "./repository";
import { emitTelegramEvent } from "./events";
import { presentationTimezone } from "../timeService";

type LifecycleNotificationStatus = {
  attemptedAt: string | null;
  deliveredAt: string | null;
  status: "idle" | "attempted" | "delivered" | "failed" | "skipped";
  error: string | null;
};

const idleStatus = (): LifecycleNotificationStatus => ({
  attemptedAt: null,
  deliveredAt: null,
  status: "idle",
  error: null,
});

export class TelegramLifecycleMonitor {
  private readonly processId: string;
  private readonly startedAt = new Date();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reportingProcessFailure = false;
  private readonly processFailureDeduplication = new Map<string, number>();
  private startupSent = false;
  private shutdownSent = false;
  private readonly startupNotification: LifecycleNotificationStatus = idleStatus();
  private readonly shutdownNotification: LifecycleNotificationStatus = idleStatus();

  constructor(
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly notifications: TelegramNotificationService = telegramNotificationService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    processId?: string,
  ) {
    this.processId = processId ?? `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

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
    emitTelegramEvent("ApplicationStarted", { processId: this.processId, liveExecutionBlocked: true });
    this.heartbeatTimer = setInterval(() => void this.recordHeartbeat(), 30_000);
    this.heartbeatTimer.unref?.();
    return this.status();
  }

  async notifyStartup(input: {
    runtimeState: string;
    researchSchedulerState: string;
    postgresqlHealth: string;
    telegramState?: string;
    bootId?: string | null;
    now?: Date;
  }) {
    if (this.startupSent) return { sent: false as const, reason: "startup notification already sent" };
    const now = input.now ?? new Date();
    this.startupSent = true;
    this.startupNotification.attemptedAt = now.toISOString();
    this.startupNotification.status = "attempted";
    this.startupNotification.error = null;
    const text = formatApplicationOnline({
      startedAt: now.toISOString(),
      environment: this.env.NODE_ENV || "production",
      application: "FinCoach",
      runtimeState: input.runtimeState,
      researchSchedulerState: input.researchSchedulerState,
      postgresqlHealth: input.postgresqlHealth,
      telegramState: input.telegramState ?? "connected",
      bootId: input.bootId ?? this.processId,
      timezone: presentationTimezone(this.env),
    });
    try {
      const delivery = await this.notifications.sendLifecycleImmediate(text, {
        lifecycleEvent: "startup",
        processId: this.processId,
        bootId: input.bootId ?? this.processId,
        bypassDigest: true,
        immediate: true,
        liveExecutionBlocked: true,
      });
      if (delivery.sent) {
        this.startupNotification.deliveredAt = new Date().toISOString();
        this.startupNotification.status = "delivered";
      } else {
        this.startupNotification.status = "skipped";
        this.startupNotification.error = "reason" in delivery ? delivery.reason ?? "not delivered" : "not delivered";
      }
      return delivery;
    } catch (error) {
      this.startupNotification.status = "failed";
      this.startupNotification.error = normalizeProcessFailure(error, this.env).message;
      throw error;
    }
  }

  async recordHeartbeat() {
    const heartbeatAt = new Date().toISOString();
    await this.repository.saveLifecycleState({ processId: this.processId, heartbeatAt, cleanShutdown: false, startedAt: this.startedAt.toISOString() });
    emitTelegramEvent("ApplicationHeartbeatRecorded", { processId: this.processId, heartbeatAt });
  }

  async stop(reason = "graceful_shutdown", input: { runtimeState?: string; lastCompletedResearchCycle?: string | null; bootId?: string | null; timeoutMs?: number; now?: Date } = {}) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const stoppedAt = new Date();
    await this.repository.saveLifecycleState({
      processId: this.processId,
      heartbeatAt: stoppedAt.toISOString(),
      cleanShutdown: true,
      startedAt: this.startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
    });
    if (this.shutdownSent) {
      emitTelegramEvent("ApplicationStopping", { processId: this.processId, reason, duplicate: true });
      return { sent: false as const, reason: "shutdown notification already sent" };
    }
    this.shutdownSent = true;
    this.shutdownNotification.attemptedAt = stoppedAt.toISOString();
    this.shutdownNotification.status = "attempted";
    this.shutdownNotification.error = null;
    const text = formatApplicationOffline({
      stoppedAt: stoppedAt.toISOString(),
      reason,
      uptime: formatDuration(stoppedAt.getTime() - this.startedAt.getTime()),
      lastRuntimeState: input.runtimeState ?? "unknown",
      lastCompletedResearchCycle: input.lastCompletedResearchCycle ?? null,
      bootId: input.bootId ?? this.processId,
      timezone: presentationTimezone(this.env),
    });
    const attempt = this.notifications.sendLifecycleImmediate(text, {
      lifecycleEvent: "shutdown",
      reason,
      processId: this.processId,
      bootId: input.bootId ?? this.processId,
      bypassDigest: true,
      immediate: true,
      liveExecutionBlocked: true,
    });
    try {
      const delivery = await withTimeout(attempt, input.timeoutMs ?? 3_000, "telegram shutdown notification timed out");
      if (delivery.sent) {
        this.shutdownNotification.deliveredAt = new Date().toISOString();
        this.shutdownNotification.status = "delivered";
      } else {
        this.shutdownNotification.status = "skipped";
        this.shutdownNotification.error = "reason" in delivery ? delivery.reason ?? "not delivered" : "not delivered";
      }
      emitTelegramEvent("ApplicationStopping", { processId: this.processId, reason });
      return delivery;
    } catch (error) {
      this.shutdownNotification.status = "failed";
      this.shutdownNotification.error = normalizeProcessFailure(error, this.env).message;
      emitTelegramEvent("ApplicationStopping", { processId: this.processId, reason, notificationError: this.shutdownNotification.error });
      return { sent: false as const, reason: this.shutdownNotification.error };
    }
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

  status() {
    return {
      processId: this.processId,
      startedAt: this.startedAt.toISOString(),
      heartbeatActive: Boolean(this.heartbeatTimer),
      startupNotification: { ...this.startupNotification },
      shutdownNotification: { ...this.shutdownNotification },
      liveExecutionBlocked: true,
    };
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export const telegramLifecycleMonitor = new TelegramLifecycleMonitor();
