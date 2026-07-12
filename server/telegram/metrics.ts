import type { TelegramMetricsSnapshot } from "./contracts";
import { redactTelegramSecrets } from "./formatter";

export class TelegramMetrics {
  private counters = {
    sendsAttempted: 0,
    sendsSucceeded: 0,
    sendsFailed: 0,
    rateLimits: 0,
    commandsReceived: 0,
    unauthorizedCommands: 0,
    summariesGenerated: 0,
    summaryGenerationAttempts: 0,
    summariesCreated: 0,
    existingSummariesReused: 0,
    automaticSummarySends: 0,
    manualSummarySends: 0,
    duplicateSummarySendsSuppressed: 0,
    schedulerJobsCompleted: 0,
    schedulerJobsFailed: 0,
    schedulerJobsSkipped: 0,
    schedulerPersistenceFailures: 0,
    signalsConsidered: 0,
    signalsRejected: 0,
    signalsPublished: 0,
    duplicatesSuppressed: 0,
    staleSignalsSuppressed: 0,
    killSwitchSuppressions: 0,
    updatesReceived: 0,
    updatesProcessed: 0,
    updatesIgnored: 0,
    updatesFailed: 0,
    repliesSent: 0,
    replyFailures: 0,
    pollingReconnects: 0,
  };
  private summaryStatus = {
    daily: null as string | null,
    weekly: null as string | null,
  };
  private lastSchedulerError: string | null = null;
  private lastSuccessfulAutomaticSend = {
    daily: null as string | null,
    weekly: null as string | null,
  };
  private signalResultsByOutcome = new Map<string, number>();
  private resultR: number[] = [];
  private deliveryLatencyMs: number[] = [];

  increment(name: keyof typeof this.counters, by = 1) {
    this.counters[name] += by;
  }

  recordDelivery(ok: boolean, latencyMs: number | null, rateLimited = false) {
    this.increment("sendsAttempted");
    if (ok) this.increment("sendsSucceeded");
    else this.increment("sendsFailed");
    if (rateLimited) this.increment("rateLimits");
    if (latencyMs !== null && Number.isFinite(latencyMs)) this.deliveryLatencyMs.push(latencyMs);
  }

  recordSignalOutcome(outcome: string, resultR: number | null) {
    this.signalResultsByOutcome.set(outcome, (this.signalResultsByOutcome.get(outcome) ?? 0) + 1);
    if (resultR !== null && Number.isFinite(resultR)) this.resultR.push(resultR);
  }

  recordSummaryResult(period: "daily" | "weekly", status: "created" | "existing") {
    this.increment("summaryGenerationAttempts");
    if (status === "created") {
      this.increment("summariesCreated");
      this.increment("summariesGenerated");
    } else {
      this.increment("existingSummariesReused");
    }
    this.summaryStatus[period] = status;
  }

  recordSummarySend(period: "daily" | "weekly", mode: "automatic" | "manual", sent: boolean) {
    if (sent && mode === "automatic") {
      this.increment("automaticSummarySends");
      this.lastSuccessfulAutomaticSend[period] = new Date().toISOString();
    } else if (sent) {
      this.increment("manualSummarySends");
    } else {
      this.increment("duplicateSummarySendsSuppressed");
    }
  }

  recordSchedulerJob(status: "completed" | "failed" | "skipped", error?: unknown) {
    if (status === "completed") this.increment("schedulerJobsCompleted");
    if (status === "skipped") this.increment("schedulerJobsSkipped");
    if (status === "failed") {
      this.increment("schedulerJobsFailed");
      this.lastSchedulerError = redactMessage(error);
    }
  }

  recordSchedulerPersistenceFailure(error: unknown) {
    this.increment("schedulerPersistenceFailures");
    this.lastSchedulerError = redactMessage(error);
  }

  snapshot(): TelegramMetricsSnapshot {
    return {
      ...this.counters,
      lastDailySummaryStatus: this.summaryStatus.daily,
      lastWeeklySummaryStatus: this.summaryStatus.weekly,
      lastSchedulerError: this.lastSchedulerError,
      lastSuccessfulAutomaticDailySend: this.lastSuccessfulAutomaticSend.daily,
      lastSuccessfulAutomaticWeeklySend: this.lastSuccessfulAutomaticSend.weekly,
      signalResultsByOutcome: Object.fromEntries(this.signalResultsByOutcome.entries()),
      averageSignalR: averageOrNull(this.resultR),
      averageDeliveryLatencyMs: averageOrNull(this.deliveryLatencyMs),
    };
  }
}

function redactMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactTelegramSecrets(message));
}

function averageOrNull(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

export const telegramMetrics = new TelegramMetrics();
