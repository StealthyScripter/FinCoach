import type { TelegramMetricsSnapshot } from "./contracts";

export class TelegramMetrics {
  private counters = {
    sendsAttempted: 0,
    sendsSucceeded: 0,
    sendsFailed: 0,
    rateLimits: 0,
    commandsReceived: 0,
    unauthorizedCommands: 0,
    summariesGenerated: 0,
    signalsConsidered: 0,
    signalsRejected: 0,
    signalsPublished: 0,
    duplicatesSuppressed: 0,
    staleSignalsSuppressed: 0,
    killSwitchSuppressions: 0,
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

  snapshot(): TelegramMetricsSnapshot {
    return {
      ...this.counters,
      signalResultsByOutcome: Object.fromEntries(this.signalResultsByOutcome.entries()),
      averageSignalR: averageOrNull(this.resultR),
      averageDeliveryLatencyMs: averageOrNull(this.deliveryLatencyMs),
    };
  }
}

function averageOrNull(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

export const telegramMetrics = new TelegramMetrics();
