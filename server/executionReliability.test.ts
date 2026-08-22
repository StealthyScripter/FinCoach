import assert from "node:assert/strict";
import { BrokerReconciliationService } from "./execution/brokerReconciliationService";
import { evaluatePracticeTradeCapacity, loadMaxActivePracticeTrades } from "./execution/practiceTradeCapacity";
import { ExecutionFunnelTelemetry } from "./execution/executionFunnelTelemetry";
import { SandboxBrokerRuntime } from "./execution/sandboxBrokerRuntime";
import type {
  BrokerHealth,
  BrokerInstrument,
  DemoBrokerAdapter,
  PricingSnapshot,
  SandboxAccountSummary,
  SandboxOrderPreview,
  SandboxOrderResult,
  SandboxPosition,
  SandboxTrade,
} from "./execution/brokerSandbox";
import { SubmissionIdempotencyService } from "./execution/submissionIdempotencyService";
import { EventLogService } from "./eventLogService";
import { ExecutionAuditLog } from "./execution/riskControls";
import { SandboxExecutionMetrics } from "./execution/sandboxMetrics";

class ReliabilityAdapter implements DemoBrokerAdapter {
  readonly id = "metatrader_demo" as const;
  readonly environment = "demo" as const;
  readonly productionOrderSubmissionEnabled = false as const;

  async health(): Promise<BrokerHealth> {
    return { provider: this.id, connected: true, environment: "demo", status: "healthy", reason: null, checkedAt: new Date().toISOString(), productionOrderSubmissionEnabled: false };
  }
  async getAccountSummary(): Promise<SandboxAccountSummary> {
    return { provider: this.id, accountId: "demo", mode: "demo", currency: "USD", balance: 1000, equity: 1000, marginUsed: 0, marginAvailable: 1000, pendingOrderCount: 0, openPositionCount: 1, openTradeCount: 1 };
  }
  async getInstruments(): Promise<BrokerInstrument[]> { return []; }
  async getPricingSnapshot(): Promise<PricingSnapshot> { throw new Error("not used"); }
  async previewOrder(): Promise<SandboxOrderPreview> { throw new Error("not used"); }
  async submitSandboxOrder(): Promise<SandboxOrderResult> { throw new Error("not used"); }
  async getOrderStatus(orderId: string): Promise<SandboxOrderResult> {
    if (orderId === "missing-order") throw new Error("not found");
    return { provider: this.id, orderId, status: "filled", reason: null, submittedAt: new Date().toISOString(), productionOrderSubmissionEnabled: false };
  }
  async getOpenPositions(): Promise<SandboxPosition[]> {
    return [{ id: "position-1", instrument: "EUR/USD", providerSymbol: "EURUSD", side: "buy", units: 1, entryPrice: 1.1, unrealizedPnL: 0 }];
  }
  async getPendingOrders(): Promise<SandboxOrderResult[]> { return []; }
  async getTrades(): Promise<SandboxTrade[]> {
    return [{ id: "trade-1", instrument: "EUR/USD", providerSymbol: "EURUSD", side: "buy", units: 1, price: 1.1, openedAt: new Date().toISOString(), state: "open" }];
  }
  async disconnect() { return this.health(); }
}

const idempotency = new SubmissionIdempotencyService<{ orderId: string }>();
let operations = 0;
let release!: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });
const operation = async () => {
  operations += 1;
  await gate;
  return { orderId: "order-1" };
};
const first = idempotency.execute("submission-key-1", { previewId: "preview-1" }, operation);
const concurrentReplay = idempotency.execute("submission-key-1", { previewId: "preview-1" }, operation);
release();
const [firstResult, replayResult] = await Promise.all([first, concurrentReplay]);
assert.equal(operations, 1);
assert.equal(firstResult.replayed, false);
assert.equal(replayResult.replayed, true);
assert.deepEqual(firstResult.result, replayResult.result);
const completedReplay = await idempotency.execute("submission-key-1", { previewId: "preview-1" }, operation);
assert.equal(completedReplay.replayed, true);
assert.equal(operations, 1);
await assert.rejects(
  () => idempotency.execute("submission-key-1", { previewId: "different-preview" }, operation),
  /different submission/,
);

const events = new EventLogService();
const audit = new ExecutionAuditLog();
const metrics = new SandboxExecutionMetrics();
const blockerEvents: any[] = [];
const blockerService = { record: async (event: any) => { blockerEvents.push(event); return event; } };
const reconciliation = new BrokerReconciliationService(events, audit, metrics, undefined, undefined, blockerService as never);
const adapter = new ReliabilityAdapter();
const matched = await reconciliation.reconcile(adapter, [{
  provider: "metatrader_demo",
  orderId: "order-1",
  expectedStatus: "pending",
  submittedAt: "2026-06-20T10:00:00.000Z",
  idempotencyKey: "submission-key-1",
}], "operator", new Date("2026-06-20T10:05:00.000Z"));
assert.equal(matched.status, "matched");
assert.equal(matched.matchedOrderCount, 1);
assert.equal(matched.productionOrderSubmissionEnabled, false);

const discrepancy = await reconciliation.reconcile(adapter, [{
  provider: "metatrader_demo",
  orderId: "missing-order",
  expectedStatus: "filled",
  submittedAt: "2026-06-20T10:00:00.000Z",
  idempotencyKey: "submission-key-2",
}], "operator", new Date("2026-06-20T10:06:00.000Z"));
assert.equal(discrepancy.status, "discrepancy");
assert.equal(discrepancy.discrepancies[0].type, "missing_order");
assert.equal(events.countByType("sandbox.reconciliation_completed"), 2);
assert.equal(metrics.snapshot().reconciliationCount, 2);
assert.equal(metrics.snapshot().reconciliationFailureCount, 1);
assert.ok(audit.list().some((entry) => entry.action === "sandbox.reconciliation"));

const historicalIncident = await reconciliation.reconcile(adapter, [], "operator", new Date("2026-06-20T10:07:00.000Z"), {
  localActiveTrades: [
    { id: "local-1", provider: "metatrader_demo", brokerTradeId: "missing-trade-1", instrument: "EUR/USD", state: "active" },
    { id: "local-2", provider: "metatrader_demo", brokerTradeId: "missing-trade-2", instrument: "EUR/USD", state: "active" },
    { id: "local-3", provider: "metatrader_demo", brokerTradeId: "missing-trade-3", instrument: "EUR/USD", state: "active" },
  ],
});
assert.equal(historicalIncident.status, "discrepancy");
assert.equal(historicalIncident.localActiveTrades, 3);
assert.equal(historicalIncident.brokerActiveTrades, 1);
assert.equal(historicalIncident.mismatchedTrades, 3);
assert.ok(historicalIncident.discrepancies.some((item) => item.type === "local_active_broker_missing"));
assert.ok(blockerEvents.some((event) => event.code === "broker_trade_missing" && event.alertCategory === "BROKER_STATE_MISMATCH"));
const afterMismatch = evaluatePracticeTradeCapacity({
  maxActivePracticeTrades: 3,
  brokerConfirmedActiveTrades: 0,
  localActiveTrades: [
    { id: "local-1", provider: "metatrader_demo", instrument: "EUR/USD", state: "missing_at_broker" },
    { id: "local-2", provider: "metatrader_demo", instrument: "EUR/USD", state: "missing_at_broker" },
    { id: "local-3", provider: "metatrader_demo", instrument: "EUR/USD", state: "missing_at_broker" },
  ],
  reconciliationStatus: "healthy",
});
assert.equal(afterMismatch.allowed, true, "stale local active rows must not silently enforce the practice cap after broker reconciliation");
assert.equal(afterMismatch.activeTradeCountUsed, 0);

const legitimateCap = evaluatePracticeTradeCapacity({ maxActivePracticeTrades: 3, brokerConfirmedActiveTrades: 3, reconciliationStatus: "healthy" });
assert.equal(legitimateCap.allowed, false);
assert.equal(legitimateCap.code, "practice_active_trade_cap_reached");
assert.equal(legitimateCap.expectedPolicyRejection, true);
assert.equal(legitimateCap.alertCategory, "EXPECTED_POLICY_REJECTION");
const staleReconciliation = evaluatePracticeTradeCapacity({ maxActivePracticeTrades: 3, brokerConfirmedActiveTrades: 0, reconciliationStatus: "stale" });
assert.equal(staleReconciliation.allowed, false);
assert.equal(staleReconciliation.code, "reconciliation_stale");
assert.equal(staleReconciliation.expectedPolicyRejection, false);
assert.equal(loadMaxActivePracticeTrades({} as NodeJS.ProcessEnv), 25);
assert.equal(loadMaxActivePracticeTrades({ FINCOACH_MAX_ACTIVE_PRACTICE_TRADES: "75" } as NodeJS.ProcessEnv), 75);
assert.throws(() => loadMaxActivePracticeTrades({ FINCOACH_MAX_ACTIVE_PRACTICE_TRADES: "0" } as NodeJS.ProcessEnv), /FINCOACH_MAX_ACTIVE_PRACTICE_TRADES/);

const disabledSchedulerRuntime = new SandboxBrokerRuntime({ FINCOACH_BROKER_RECONCILIATION_ENABLED: "false" } as NodeJS.ProcessEnv);
disabledSchedulerRuntime.startReconciliationScheduler();
assert.equal(disabledSchedulerRuntime.reconciliationSchedulerHealth().enabled, false);
assert.equal(disabledSchedulerRuntime.reconciliationSchedulerHealth().active, false);

const idleSchedulerRuntime = new SandboxBrokerRuntime({
  FINCOACH_BROKER_RECONCILIATION_INTERVAL_MS: "60000",
  OANDA_ENV: "practice",
} as NodeJS.ProcessEnv);
idleSchedulerRuntime.startReconciliationScheduler();
assert.equal(idleSchedulerRuntime.reconciliationSchedulerHealth().enabled, true);
assert.equal(idleSchedulerRuntime.reconciliationSchedulerHealth().active, true);
assert.equal(idleSchedulerRuntime.reconciliationSchedulerHealth().providerConfigured, false);
idleSchedulerRuntime.stopReconciliationSchedulerForTest();
assert.equal(idleSchedulerRuntime.reconciliationSchedulerHealth().active, false);

const funnel = new ExecutionFunnelTelemetry();
funnel.increment("tradeCandidatesEvaluated", 100);
funnel.classifyRejection("RR below threshold");
funnel.classifyRejection("Spread exceeds the configured limit");
funnel.classifyRejection("broker account authentication failed");
funnel.classifyRejection("reconciliation is stale");
funnel.increment("brokerSubmissionAttempted", 54);
funnel.increment("brokerAccepted", 53);
funnel.increment("brokerTradesConfirmed", 52);
assert.deepEqual({
  evaluated: funnel.snapshot().tradeCandidatesEvaluated,
  strategyRejected: funnel.snapshot().strategyRejected,
  riskRejected: funnel.snapshot().riskRejected,
  configRejected: funnel.snapshot().configRejected,
  reconciliationBlocked: funnel.snapshot().reconciliationBlocked,
  submitted: funnel.snapshot().brokerSubmissionAttempted,
  accepted: funnel.snapshot().brokerAccepted,
  confirmed: funnel.snapshot().brokerTradesConfirmed,
}, {
  evaluated: 100,
  strategyRejected: 0,
  riskRejected: 2,
  configRejected: 1,
  reconciliationBlocked: 1,
  submitted: 54,
  accepted: 53,
  confirmed: 52,
});

console.log("execution reliability tests passed");
