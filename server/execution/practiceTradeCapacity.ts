import type { LocalActiveTradeAssumption } from "./brokerReconciliationService";

const DEFAULT_MAX_ACTIVE_PRACTICE_TRADES = 25;

export type PracticeTradeCapacityInput = {
  maxActivePracticeTrades?: number;
  brokerConfirmedActiveTrades: number;
  localActiveTrades?: LocalActiveTradeAssumption[];
  reconciliationStatus: "never_run" | "healthy" | "discrepancy" | "failed" | "stale";
};

export function loadMaxActivePracticeTrades(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.FINCOACH_MAX_ACTIVE_PRACTICE_TRADES?.trim();
  if (!raw) return DEFAULT_MAX_ACTIVE_PRACTICE_TRADES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("FINCOACH_MAX_ACTIVE_PRACTICE_TRADES must be an integer between 1 and 500.");
  }
  return parsed;
}

export function evaluatePracticeTradeCapacity(input: PracticeTradeCapacityInput) {
  const limit = input.maxActivePracticeTrades ?? DEFAULT_MAX_ACTIVE_PRACTICE_TRADES;
  if (input.reconciliationStatus === "failed" || input.reconciliationStatus === "stale" || input.reconciliationStatus === "never_run") {
    return {
      allowed: false,
      code: input.reconciliationStatus === "stale" ? "reconciliation_stale" : "reconciliation_failed",
      alertCategory: "BROKER_RECONCILIATION_FAILURE" as const,
      expectedPolicyRejection: false,
      activeTradeCountUsed: null,
      limit,
      reason: "Practice active-trade count cannot be trusted until broker reconciliation is current.",
    };
  }
  const count = input.brokerConfirmedActiveTrades;
  if (count >= limit) {
    return {
      allowed: false,
      code: "practice_active_trade_cap_reached",
      alertCategory: "EXPECTED_POLICY_REJECTION" as const,
      expectedPolicyRejection: true,
      activeTradeCountUsed: count,
      limit,
      reason: "Broker-confirmed active practice trade count reached the configured practice guard.",
    };
  }
  return {
    allowed: true,
    code: "practice_active_trade_capacity_available",
    alertCategory: "EXPECTED_POLICY_REJECTION" as const,
    expectedPolicyRejection: true,
    activeTradeCountUsed: count,
    limit,
    reason: "Broker-confirmed active practice trade count is below the configured practice guard.",
  };
}
