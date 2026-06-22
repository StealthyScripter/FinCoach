import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import type { DemoBrokerAdapter, SandboxOrderResult } from "./brokerSandbox";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { sandboxExecutionMetrics, type SandboxExecutionMetrics } from "./sandboxMetrics";
import { brokerRetryService, type BrokerRetryService } from "./brokerRetryService";
import { reliabilityStateStore, type ReliabilityStateStore } from "./reliabilityStateStore";

export type TrackedSandboxOrder = {
  provider: DemoBrokerAdapter["id"];
  orderId: string;
  expectedStatus: SandboxOrderResult["status"];
  expectedFilledUnits?: number;
  submittedAt: string;
  idempotencyKey: string;
};

export type BrokerReconciliationReport = {
  id: string;
  provider: DemoBrokerAdapter["id"];
  status: "matched" | "discrepancy";
  trackedOrderCount: number;
  matchedOrderCount: number;
  discrepancies: Array<{
    orderId: string;
    type: "missing_order" | "status_mismatch" | "fill_quantity_mismatch";
    expected: string;
    actual: string | null;
  }>;
  broker: {
    pendingOrderCount: number;
    openPositionCount: number;
    openTradeCount: number;
    reportedPendingOrderCount: number;
    reportedOpenPositionCount: number;
    reportedOpenTradeCount: number;
  };
  reconciledAt: string;
  productionOrderSubmissionEnabled: false;
};

export class BrokerReconciliationService {
  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: SandboxExecutionMetrics = sandboxExecutionMetrics,
    private readonly retry: BrokerRetryService = brokerRetryService,
    private readonly store: ReliabilityStateStore = reliabilityStateStore,
  ) {}

  async reconcile(adapter: DemoBrokerAdapter, trackedOrders: TrackedSandboxOrder[], userId = "system", now = new Date()) {
    const providerOrders = trackedOrders.filter((order) => order.provider === adapter.id);
    const [accountResult, pendingOrdersResult, positionsResult, tradesResult] = await Promise.all([
      this.retry.read(() => adapter.getAccountSummary(), undefined, { provider: adapter.id, operation: "reconcile_account" }),
      this.retry.read(() => adapter.getPendingOrders(), undefined, { provider: adapter.id, operation: "reconcile_pending_orders" }),
      this.retry.read(() => adapter.getOpenPositions(), undefined, { provider: adapter.id, operation: "reconcile_positions" }),
      this.retry.read(() => adapter.getTrades(), undefined, { provider: adapter.id, operation: "reconcile_trades" }),
    ]);
    const account = accountResult.value;
    const pendingOrders = pendingOrdersResult.value;
    const positions = positionsResult.value;
    const trades = tradesResult.value;
    const statuses = await Promise.all(providerOrders.map(async (tracked) => {
      try {
        return {
          tracked,
          actual: (await this.retry.read(
            () => adapter.getOrderStatus(tracked.orderId),
            undefined,
            { provider: adapter.id, operation: "reconcile_order_status" },
          )).value,
        };
      } catch {
        return { tracked, actual: null };
      }
    }));
    const discrepancies: BrokerReconciliationReport["discrepancies"] = [];
    statuses.forEach(({ tracked, actual }) => {
      if (!actual) {
        discrepancies.push({ orderId: tracked.orderId, type: "missing_order", expected: tracked.expectedStatus, actual: null });
        return;
      }
      if (!terminalEquivalent(tracked.expectedStatus, actual.status)) {
        discrepancies.push({ orderId: tracked.orderId, type: "status_mismatch", expected: tracked.expectedStatus, actual: actual.status });
        return;
      }
      if (tracked.expectedFilledUnits !== undefined && actual.filledUnits !== undefined && tracked.expectedFilledUnits !== actual.filledUnits) {
        discrepancies.push({
          orderId: tracked.orderId,
          type: "fill_quantity_mismatch",
          expected: String(tracked.expectedFilledUnits),
          actual: String(actual.filledUnits),
        });
      }
    });
    const report: BrokerReconciliationReport = {
      id: randomUUID(),
      provider: adapter.id,
      status: discrepancies.length ? "discrepancy" : "matched",
      trackedOrderCount: providerOrders.length,
      matchedOrderCount: providerOrders.length - discrepancies.length,
      discrepancies,
      broker: {
        pendingOrderCount: pendingOrders.length,
        openPositionCount: positions.length,
        openTradeCount: trades.length,
        reportedPendingOrderCount: account.pendingOrderCount,
        reportedOpenPositionCount: account.openPositionCount,
        reportedOpenTradeCount: account.openTradeCount,
      },
      reconciledAt: now.toISOString(),
      productionOrderSubmissionEnabled: false,
    };
    this.store.set("broker_reconciliation", report.id, report);
    this.events.append({
      type: "sandbox.reconciliation_completed",
      userId,
      sourceService: "sandbox-broker-reconciliation",
      correlationId: report.id,
      payload: {
        provider: adapter.id,
        status: report.status,
        trackedOrderCount: report.trackedOrderCount,
        discrepancyCount: discrepancies.length,
        productionOrderSubmissionEnabled: false,
      },
      createdAt: report.reconciledAt,
    });
    this.audit.append({
      action: "sandbox.reconciliation",
      outcome: discrepancies.length ? "rejected" : "accepted",
      correlationId: report.id,
      detail: {
        provider: adapter.id,
        status: report.status,
        discrepancies,
        productionOrderSubmissionEnabled: false,
      },
    });
    this.metrics.recordReconciliation(discrepancies.length === 0, now);
    return clone(report);
  }

  list() {
    return this.store.list<BrokerReconciliationReport>("broker_reconciliation")
      .sort((left, right) => right.reconciledAt.localeCompare(left.reconciledAt))
      .map(clone);
  }
}

function terminalEquivalent(expected: SandboxOrderResult["status"], actual: SandboxOrderResult["status"]) {
  return expected === actual
    || expected === "pending" && (actual === "partially_filled" || actual === "filled")
    || expected === "partially_filled" && actual === "filled";
}

function clone(report: BrokerReconciliationReport): BrokerReconciliationReport {
  return {
    ...report,
    broker: { ...report.broker },
    discrepancies: report.discrepancies.map((item) => ({ ...item })),
  };
}

export const brokerReconciliationService = new BrokerReconciliationService();
