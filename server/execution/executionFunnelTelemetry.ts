export type ExecutionFunnelCounter =
  | "tradeCandidatesEvaluated"
  | "strategyRejected"
  | "riskRejected"
  | "configRejected"
  | "providerRejected"
  | "reconciliationBlocked"
  | "brokerSubmissionAttempted"
  | "brokerAccepted"
  | "brokerRejected"
  | "brokerTradesConfirmed"
  | "brokerTradesMissing"
  | "brokerTradesClosed"
  | "activeBrokerTrades";

export class ExecutionFunnelTelemetry {
  private readonly counters: Record<ExecutionFunnelCounter, number> = {
    tradeCandidatesEvaluated: 0,
    strategyRejected: 0,
    riskRejected: 0,
    configRejected: 0,
    providerRejected: 0,
    reconciliationBlocked: 0,
    brokerSubmissionAttempted: 0,
    brokerAccepted: 0,
    brokerRejected: 0,
    brokerTradesConfirmed: 0,
    brokerTradesMissing: 0,
    brokerTradesClosed: 0,
    activeBrokerTrades: 0,
  };

  increment(counter: ExecutionFunnelCounter, amount = 1) {
    this.counters[counter] += amount;
  }

  set(counter: ExecutionFunnelCounter, value: number) {
    this.counters[counter] = Math.max(0, Math.floor(value));
  }

  classifyRejection(reason: string) {
    const normalized = reason.toLowerCase();
    if (/risk|rr|spread|loss|exposure|position|margin|volatility|blackout/.test(normalized)) {
      this.increment("riskRejected");
      return "riskRejected";
    }
    if (/broker|account|credential|provider|market data|stale|reconcil|config/.test(normalized)) {
      const counter: ExecutionFunnelCounter = /reconcil/.test(normalized)
        ? "reconciliationBlocked"
        : /provider|market data|stale/.test(normalized)
          ? "providerRejected"
          : "configRejected";
      this.increment(counter);
      return counter;
    }
    this.increment("strategyRejected");
    return "strategyRejected";
  }

  snapshot() {
    return { ...this.counters, liveExecutionBlocked: true };
  }

  resetForTest() {
    for (const key of Object.keys(this.counters) as ExecutionFunnelCounter[]) this.counters[key] = 0;
  }
}

export const executionFunnelTelemetry = new ExecutionFunnelTelemetry();
