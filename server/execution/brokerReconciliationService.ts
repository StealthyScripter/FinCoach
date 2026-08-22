import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import type { DemoBrokerAdapter, SandboxOrderResult } from "./brokerSandbox";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { sandboxExecutionMetrics, type SandboxExecutionMetrics } from "./sandboxMetrics";
import { brokerRetryService, type BrokerRetryService } from "./brokerRetryService";
import { reliabilityStateStore, type ReliabilityStateStore } from "./reliabilityStateStore";
import { operationalBlockerService, type OperationalBlockerService } from "../operationalBlockerService";
import { executionFunnelTelemetry } from "./executionFunnelTelemetry";

export type TrackedSandboxOrder = {
  provider: DemoBrokerAdapter["id"];
  orderId: string;
  expectedStatus: SandboxOrderResult["status"];
  expectedFilledUnits?: number;
  submittedAt: string;
  idempotencyKey: string;
};

export type LocalActiveTradeAssumption = {
  id: string;
  provider: DemoBrokerAdapter["id"];
  brokerTradeId?: string | null;
  brokerOrderId?: string | null;
  instrument: string;
  state: "active" | "pending" | "submitted" | "reconciliation_required" | "missing_at_broker" | "closed_at_broker";
};

export type BrokerReconciliationReport = {
  id: string;
  provider: DemoBrokerAdapter["id"];
  status: "matched" | "discrepancy";
  trackedOrderCount: number;
  matchedOrderCount: number;
  discrepancies: Array<{
    orderId: string;
    type: "missing_order" | "status_mismatch" | "fill_quantity_mismatch" | "local_active_broker_missing" | "local_pending_order_missing" | "orphan_broker_trade";
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
  lastReconciliationAttemptAt: string;
  lastSuccessfulReconciliationAt: string | null;
  localActiveTrades: number;
  brokerActiveTrades: number;
  localPendingOrders: number;
  brokerPendingOrders: number;
  mismatchedTrades: number;
  orphanBrokerTrades: number;
  reconciledSinceStartup: number;
  productionOrderSubmissionEnabled: false;
};

export class BrokerReconciliationService {
  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: SandboxExecutionMetrics = sandboxExecutionMetrics,
    private readonly retry: BrokerRetryService = brokerRetryService,
    private readonly store: ReliabilityStateStore = reliabilityStateStore,
    private readonly blockers: OperationalBlockerService = operationalBlockerService,
  ) {}

  private lastAttemptAt: string | null = null;
  private lastSuccessfulAt: string | null = null;
  private latestStatus: "never_run" | "healthy" | "discrepancy" | "failed" = "never_run";
  private latestError: string | null = null;
  private reconciledSinceStartup = 0;

  async reconcile(adapter: DemoBrokerAdapter, trackedOrders: TrackedSandboxOrder[], userId = "system", now = new Date(), options: { localActiveTrades?: LocalActiveTradeAssumption[] } = {}) {
    this.lastAttemptAt = now.toISOString();
    const providerOrders = trackedOrders.filter((order) => order.provider === adapter.id);
    let accountResult: { value: Awaited<ReturnType<DemoBrokerAdapter["getAccountSummary"]>> };
    let pendingOrdersResult: { value: Awaited<ReturnType<DemoBrokerAdapter["getPendingOrders"]>> };
    let positionsResult: { value: Awaited<ReturnType<DemoBrokerAdapter["getOpenPositions"]>> };
    let tradesResult: { value: Awaited<ReturnType<DemoBrokerAdapter["getTrades"]>> };
    try {
      [accountResult, pendingOrdersResult, positionsResult, tradesResult] = await Promise.all([
        this.retry.read(() => adapter.getAccountSummary(), undefined, { provider: adapter.id, operation: "reconcile_account" }),
        this.retry.read(() => adapter.getPendingOrders(), undefined, { provider: adapter.id, operation: "reconcile_pending_orders" }),
        this.retry.read(() => adapter.getOpenPositions(), undefined, { provider: adapter.id, operation: "reconcile_positions" }),
        this.retry.read(() => adapter.getTrades(), undefined, { provider: adapter.id, operation: "reconcile_trades" }),
      ]);
    } catch (error) {
      this.latestStatus = "failed";
      this.latestError = error instanceof Error ? error.message : "Broker reconciliation failed";
      await this.blockers.record({
        kind: "dependency",
        code: /token|auth|401|403/i.test(this.latestError) ? "broker_authentication_failed" : "reconciliation_failed",
        title: "Broker reconciliation failed",
        whatBlocked: "broker-confirmed practice execution state",
        reason: this.latestError,
        currentValue: "FAILED",
        limitValue: "successful OANDA PRACTICE reconciliation",
        scope: { component: adapter.id },
        expected: false,
        action: "Verify broker credentials, account ID, endpoint, and provider reachability.",
        effect: "Practice order flow cannot trust local active trade state until reconciliation recovers.",
        severity: "critical",
        alertCategory: /token|auth|401|403/i.test(this.latestError) ? "AUTHENTICATION_FAILURE" : "BROKER_RECONCILIATION_FAILURE",
        now,
      });
      this.metrics.recordReconciliation(false, now);
      throw error;
    }
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
    const localActive = (options.localActiveTrades ?? []).filter((trade) => trade.provider === adapter.id && trade.state === "active");
    const localPending = (options.localActiveTrades ?? []).filter((trade) => trade.provider === adapter.id && (trade.state === "pending" || trade.state === "submitted"));
    const brokerTradeIds = new Set(trades.map((trade) => trade.id));
    const brokerOrderIds = new Set([...pendingOrders.map((order) => order.orderId), ...statuses.map((item) => item.actual?.orderId).filter((id): id is string => Boolean(id))]);
    for (const local of localActive) {
      if (local.brokerTradeId && brokerTradeIds.has(local.brokerTradeId)) continue;
      if (local.brokerOrderId && brokerOrderIds.has(local.brokerOrderId)) continue;
      discrepancies.push({ orderId: local.brokerOrderId ?? local.brokerTradeId ?? local.id, type: "local_active_broker_missing", expected: "local active trade exists at broker", actual: null });
    }
    for (const local of localPending) {
      if (local.brokerOrderId && brokerOrderIds.has(local.brokerOrderId)) continue;
      discrepancies.push({ orderId: local.brokerOrderId ?? local.id, type: "local_pending_order_missing", expected: "local pending order exists at broker", actual: null });
    }
    for (const brokerTrade of trades) {
      const known = localActive.some((local) => local.brokerTradeId === brokerTrade.id || local.brokerOrderId === brokerTrade.id);
      if (!known && localActive.length > 0) {
        discrepancies.push({ orderId: brokerTrade.id, type: "orphan_broker_trade", expected: "local active trade record", actual: "broker active trade" });
      }
    }
    const mismatchedTrades = discrepancies.filter((item) => item.type === "local_active_broker_missing" || item.type === "local_pending_order_missing").length;
    const orphanBrokerTrades = discrepancies.filter((item) => item.type === "orphan_broker_trade").length;
    executionFunnelTelemetry.set("activeBrokerTrades", trades.filter((trade) => trade.state === "open").length);
    executionFunnelTelemetry.increment("brokerTradesMissing", mismatchedTrades);
    this.reconciledSinceStartup += 1;
    this.lastSuccessfulAt = now.toISOString();
    this.latestStatus = discrepancies.length ? "discrepancy" : "healthy";
    this.latestError = null;
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
      lastReconciliationAttemptAt: now.toISOString(),
      lastSuccessfulReconciliationAt: this.lastSuccessfulAt,
      localActiveTrades: localActive.length,
      brokerActiveTrades: trades.filter((trade) => trade.state === "open").length,
      localPendingOrders: localPending.length + providerOrders.filter((order) => order.expectedStatus === "pending").length,
      brokerPendingOrders: pendingOrders.length,
      mismatchedTrades,
      orphanBrokerTrades,
      reconciledSinceStartup: this.reconciledSinceStartup,
      productionOrderSubmissionEnabled: false,
    };
    if (discrepancies.length) {
      await this.blockers.record({
        kind: "dependency",
        code: mismatchedTrades ? "broker_trade_missing" : orphanBrokerTrades ? "orphan_broker_trade" : "broker_state_mismatch",
        title: "Broker reconciliation found a state mismatch",
        whatBlocked: "broker-confirmed practice execution state",
        reason: `${discrepancies.length} broker/local discrepancy record(s) detected`,
        currentValue: { localActiveTrades: localActive.length, brokerActiveTrades: report.brokerActiveTrades, localPendingOrders: report.localPendingOrders, brokerPendingOrders: report.brokerPendingOrders },
        limitValue: "local and broker active order/trade state match",
        scope: { component: adapter.id },
        expected: false,
        action: "Inspect OANDA PRACTICE trades/orders and reconcile local records before relying on active trade counts.",
        effect: "Stale local trades must not silently block all passing practice candidates.",
        severity: "critical",
        alertCategory: mismatchedTrades ? "BROKER_STATE_MISMATCH" : "BROKER_RECONCILIATION_FAILURE",
        count: discrepancies.length,
        now,
      });
    }
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

  health(now = new Date(), maxAgeMs = 15 * 60_000) {
    const latest = this.list()[0] ?? null;
    const successAt = latest?.lastSuccessfulReconciliationAt ?? this.lastSuccessfulAt;
    const ageMs = successAt ? now.getTime() - Date.parse(successAt) : Infinity;
    const stale = !Number.isFinite(ageMs) || ageMs > maxAgeMs;
    return {
      lastReconciliationAttemptAt: this.lastAttemptAt,
      lastSuccessfulReconciliationAt: successAt,
      reconciliationAgeSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
      reconciliationStatus: this.latestStatus === "failed" ? "failed" : stale ? "stale" : this.latestStatus,
      localActiveTrades: latest?.localActiveTrades ?? 0,
      brokerActiveTrades: latest?.brokerActiveTrades ?? latest?.broker.openTradeCount ?? 0,
      localPendingOrders: latest?.localPendingOrders ?? 0,
      brokerPendingOrders: latest?.brokerPendingOrders ?? latest?.broker.pendingOrderCount ?? 0,
      mismatchedTrades: latest?.mismatchedTrades ?? 0,
      orphanBrokerTrades: latest?.orphanBrokerTrades ?? 0,
      reconciledSinceStartup: this.reconciledSinceStartup,
      lastError: this.latestError,
      productionOrderSubmissionEnabled: false as const,
    };
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
