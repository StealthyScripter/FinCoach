import assert from "node:assert/strict";
import { BrokerReconciliationService } from "./execution/brokerReconciliationService";
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
const reconciliation = new BrokerReconciliationService(events, audit, metrics);
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

console.log("execution reliability tests passed");
