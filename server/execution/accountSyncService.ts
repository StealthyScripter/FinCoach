import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import type { DemoBrokerAdapter } from "./brokerSandbox";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { sandboxExecutionMetrics, type SandboxExecutionMetrics } from "./sandboxMetrics";
import { brokerRetryService, type BrokerRetryService } from "./brokerRetryService";

export class AccountSyncService {
  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: SandboxExecutionMetrics = sandboxExecutionMetrics,
    private readonly retry: BrokerRetryService = brokerRetryService,
  ) {}

  async sync(adapter: DemoBrokerAdapter, userId = "system", now = new Date()) {
    const correlationId = randomUUID();
    const [accountResult, positionsResult, pendingOrdersResult, tradesResult, healthResult] = await Promise.all([
      this.retry.read(() => adapter.getAccountSummary(), undefined, { provider: adapter.id, operation: "account_summary" }),
      this.retry.read(() => adapter.getOpenPositions(), undefined, { provider: adapter.id, operation: "open_positions" }),
      this.retry.read(() => adapter.getPendingOrders(), undefined, { provider: adapter.id, operation: "pending_orders" }),
      this.retry.read(() => adapter.getTrades(), undefined, { provider: adapter.id, operation: "trades" }),
      this.retry.read(() => adapter.health(), undefined, { provider: adapter.id, operation: "health" }),
    ]);
    const account = accountResult.value;
    const positions = positionsResult.value;
    const pendingOrders = pendingOrdersResult.value;
    const trades = tradesResult.value;
    const health = healthResult.value;
    const retryAttempts = accountResult.attempts + positionsResult.attempts + pendingOrdersResult.attempts + tradesResult.attempts + healthResult.attempts - 5;
    const snapshot = {
      provider: adapter.id,
      accountId: account.accountId,
      balance: account.balance,
      equity: account.equity,
      marginUsed: account.marginUsed,
      marginAvailable: account.marginAvailable,
      openPositions: positions,
      pendingOrders,
      trades,
      accountMode: account.mode,
      providerHealth: health,
      retryAttempts,
      syncedAt: now.toISOString(),
      productionOrderSubmissionEnabled: false as const,
    };
    this.events.append({
      type: "sandbox.account_synced",
      userId,
      sourceService: "sandbox-account-sync",
      correlationId,
      payload: {
        provider: adapter.id,
        accountId: account.accountId,
        positionCount: positions.length,
        pendingOrderCount: pendingOrders.length,
        tradeCount: trades.length,
        health: health.status,
        retryAttempts,
      },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "sandbox.account.sync",
      outcome: health.connected ? "accepted" : "rejected",
      correlationId,
      detail: {
        provider: adapter.id,
        accountId: account.accountId,
        mode: account.mode,
        positionCount: positions.length,
        pendingOrderCount: pendingOrders.length,
        retryAttempts,
        productionOrderSubmissionEnabled: false,
      },
    });
    this.metrics.recordAccountSync(now);
    return snapshot;
  }
}

export const accountSyncService = new AccountSyncService();
