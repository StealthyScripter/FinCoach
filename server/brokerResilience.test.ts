import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { AccountSyncService } from "./execution/accountSyncService";
import { SandboxBrokerError } from "./execution/brokerFailures";
import { BrokerRetryService } from "./execution/brokerRetryService";
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
import { JsonFileReliabilityStateStore } from "./execution/reliabilityStateStore";
import { SubmissionIdempotencyService } from "./execution/submissionIdempotencyService";
import { EventLogService } from "./eventLogService";
import { ExecutionAuditLog } from "./execution/riskControls";
import { SandboxExecutionMetrics } from "./execution/sandboxMetrics";
import { ProviderRecoveryTelemetry } from "./execution/providerRecoveryTelemetry";

async function main() {
let attempts = 0;
const recoveryEvents = new EventLogService();
const recoveryAudit = new ExecutionAuditLog();
const recoveryTelemetry = new ProviderRecoveryTelemetry(recoveryEvents, recoveryAudit);
const retry = new BrokerRetryService(
  { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  async () => undefined,
  recoveryTelemetry,
);
const retried = await retry.read(async () => {
  attempts += 1;
  if (attempts < 3) throw new SandboxBrokerError("rate_limited");
  return "ok";
});
assert.equal(retried.value, "ok");
assert.equal(retried.attempts, 3);
assert.equal(retried.retried, true);
assert.equal(recoveryEvents.countByType("provider.recovery_attempted"), 2);
assert.equal(recoveryEvents.countByType("provider.recovery_completed"), 1);
assert.equal(recoveryTelemetry.list()[0].recovered, 1);

let submissions = 0;
await assert.rejects(
  async () => {
    submissions += 1;
    throw new SandboxBrokerError("provider_disconnected");
  },
  /disconnected/,
);
assert.equal(submissions, 1);

const adapter = new FlakyReadAdapter();
const sync = new AccountSyncService(
  new EventLogService(),
  new ExecutionAuditLog(),
  new SandboxExecutionMetrics(),
  retry,
);
const snapshot = await sync.sync(adapter);
assert.ok(snapshot.retryAttempts >= 1);
assert.equal(adapter.accountAttempts, 3);

const file = `/tmp/marketpilot-reliability-${randomUUID()}.json`;
const firstStore = new JsonFileReliabilityStateStore(file);
const firstIdempotency = new SubmissionIdempotencyService<{ orderId: string }>(firstStore);
await firstIdempotency.execute("durable-key", { preview: "one" }, async () => ({ orderId: "durable-order" }));
const secondStore = new JsonFileReliabilityStateStore(file);
const secondIdempotency = new SubmissionIdempotencyService<{ orderId: string }>(secondStore);
const replay = await secondIdempotency.execute("durable-key", { preview: "one" }, async () => {
  throw new Error("durable replay should not execute");
});
assert.equal(replay.replayed, true);
assert.equal(replay.result.orderId, "durable-order");
assert.equal(secondStore.health().durable, true);

const ambiguousKey = "ambiguous-key";
await assert.rejects(
  () => secondIdempotency.execute(ambiguousKey, { preview: "two" }, async () => {
    throw new SandboxBrokerError("provider_disconnected");
  }),
  /disconnected/,
);
assert.equal(secondIdempotency.list().find((record) => record.key === ambiguousKey)?.status, "in_doubt");
await assert.rejects(
  () => secondIdempotency.execute(ambiguousKey, { preview: "two" }, async () => ({ orderId: "duplicate" })),
  /outcome is unknown/,
);
secondIdempotency.resolveInDoubt(ambiguousKey, { allowRetry: true });
const authorizedRetry = await secondIdempotency.execute(ambiguousKey, { preview: "two" }, async () => ({ orderId: "safe-retry" }));
assert.equal(authorizedRetry.result.orderId, "safe-retry");
unlinkSync(file);

const partial = await adapter.submitSandboxOrder({} as SandboxOrderPreview);
assert.equal(partial.status, "partially_filled");
assert.equal(partial.requestedUnits, 10);
assert.equal(partial.filledUnits, 4);
assert.equal(partial.remainingUnits, 6);

console.log("broker resilience tests passed");
}

class FlakyReadAdapter implements DemoBrokerAdapter {
  readonly id = "metatrader_demo" as const;
  readonly environment = "demo" as const;
  readonly productionOrderSubmissionEnabled = false as const;
  accountAttempts = 0;

  async health(): Promise<BrokerHealth> {
    return { provider: this.id, connected: true, environment: "demo", status: "healthy", reason: null, checkedAt: new Date().toISOString(), productionOrderSubmissionEnabled: false };
  }
  async getAccountSummary(): Promise<SandboxAccountSummary> {
    this.accountAttempts += 1;
    if (this.accountAttempts < 3) throw new SandboxBrokerError("provider_disconnected");
    return { provider: this.id, accountId: "demo", mode: "demo", currency: "USD", balance: 1000, equity: 1000, marginUsed: 0, marginAvailable: 1000, pendingOrderCount: 0, openPositionCount: 1, openTradeCount: 1 };
  }
  async getInstruments(): Promise<BrokerInstrument[]> { return []; }
  async getPricingSnapshot(): Promise<PricingSnapshot> { throw new Error("not used"); }
  async previewOrder(): Promise<SandboxOrderPreview> { throw new Error("not used"); }
  async submitSandboxOrder(): Promise<SandboxOrderResult> {
    return { provider: this.id, orderId: "partial-1", status: "partially_filled", reason: null, submittedAt: new Date().toISOString(), requestedUnits: 10, filledUnits: 4, remainingUnits: 6, averageFillPrice: 1.1, productionOrderSubmissionEnabled: false };
  }
  async getOrderStatus(): Promise<SandboxOrderResult> { return this.submitSandboxOrder({} as SandboxOrderPreview); }
  async getOpenPositions(): Promise<SandboxPosition[]> { return []; }
  async getPendingOrders(): Promise<SandboxOrderResult[]> { return []; }
  async getTrades(): Promise<SandboxTrade[]> { return []; }
  async disconnect() { return this.health(); }
}

await main();
