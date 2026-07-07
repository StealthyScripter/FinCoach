import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { SandboxBrokerError } from "./brokerFailures";
import type { DemoBrokerAdapter, SandboxOrderPreview, SandboxOrderResult } from "./brokerSandbox";
import type { OrderRequest } from "./domain";
import type { FinalConfirmationService } from "./finalConfirmation";
import type { RiskPrecheckContext, ExecutionRiskPrecheckService } from "./riskPrecheck";
import { executionRiskPrecheckService } from "./riskPrecheck";
import { executionAuditLog, executionRiskService, type ExecutionAuditLog, type ExecutionRiskService } from "./riskControls";
import { sandboxExecutionMetrics, type SandboxExecutionMetrics } from "./sandboxMetrics";
import { strategyEvidenceStore } from "./strategyEvidenceStore";
import { demoOnlyPolicyService } from "./demoOnlyPolicy";

type Confirmation = ReturnType<FinalConfirmationService["confirm"]>;

export type SandboxSignal = {
  id: string;
  strategyId: string;
  instrument: string;
  createdAt: string;
};

export type SandboxFlowInput = {
  signal: SandboxSignal;
  request: OrderRequest;
  strategyValidated: boolean;
  riskContext: RiskPrecheckContext;
  confirmation: Confirmation | ((preview: SandboxOrderPreview) => Confirmation | Promise<Confirmation>);
  adapter: DemoBrokerAdapter;
  userId: string;
};

export type SandboxFlowStage = {
  stage: "signal" | "validation" | "risk_precheck" | "order_preview" | "confirmation" | "sandbox_submit" | "order_status" | "position_monitor" | "journal_entry";
  status: "accepted" | "rejected" | "created" | "completed";
  reason: string | null;
  createdAt: string;
};

export class SandboxOrderFlowService {
  private readonly journalEntries: Array<Record<string, unknown>> = [];

  constructor(
    private readonly riskPrecheck: ExecutionRiskPrecheckService = executionRiskPrecheckService,
    private readonly risk: ExecutionRiskService = executionRiskService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly events: EventLogService = eventLogService,
    private readonly metrics: SandboxExecutionMetrics = sandboxExecutionMetrics,
  ) {}

  async execute(input: SandboxFlowInput) {
    const correlationId = input.request.correlationId || randomUUID();
    const stages: SandboxFlowStage[] = [];
    let preview: SandboxOrderPreview | null = null;
    let order: SandboxOrderResult | null = null;
    try {
      this.stage(stages, "signal", "accepted", null, correlationId, { signalId: input.signal.id });
      if (!input.strategyValidated) throw this.failure(stages, "validation", "Strategy validation did not authorize sandbox execution", correlationId);
      this.stage(stages, "validation", "accepted", null, correlationId);

      const precheck = this.riskPrecheck.evaluate(input.request, {
        ...input.riskContext,
        killSwitchActive: input.riskContext.killSwitchActive || this.risk.snapshot().globalKillSwitch,
      });
      this.stage(stages, "risk_precheck", precheck.approved ? "accepted" : "rejected", precheck.reasons.join("; ") || null, correlationId, {
        action: precheck.action,
      });
      if (!precheck.approved) {
        if (precheck.checks.some((check) => check.id === "kill_switch" && !check.passed)) throw new SandboxBrokerError("kill_switch_active");
        throw new SandboxBrokerError("order_rejected", precheck.reasons.join("; "));
      }

      const account = await input.adapter.getAccountSummary();
      demoOnlyPolicyService.assertAllowed({
        provider: input.adapter.id,
        accountMode: account.mode,
        verificationSource: `${input.adapter.id}.getAccountSummary`,
        attemptedAction: "sandbox.flow.execute",
        actor: input.userId,
        source: "sandbox-order-flow",
        metadata: { accountId: account.accountId, productionOrderSubmissionEnabled: input.adapter.productionOrderSubmissionEnabled },
      });

      preview = await input.adapter.previewOrder(input.request);
      this.stage(stages, "order_preview", "created", null, correlationId, {
        provider: input.adapter.id,
        expiresAt: preview.expiresAt,
      });

      const confirmation = typeof input.confirmation === "function"
        ? await input.confirmation(preview)
        : input.confirmation;
      if (!confirmation.accepted) {
        throw this.failure(stages, "confirmation", confirmation.reasons.join("; ") || "Confirmation was rejected", correlationId);
      }
      if (Date.parse(confirmation.expiresAt) < Date.now()) throw new SandboxBrokerError("confirmation_expired");
      if (confirmation.orderPreviewId !== preview.id || confirmation.riskSummaryHash !== preview.riskSummaryHash) {
        throw new SandboxBrokerError("order_rejected", "Confirmation is not bound to the current risk-hashed preview.");
      }
      this.stage(stages, "confirmation", "accepted", null, correlationId, { confirmationId: confirmation.id });

      if (this.risk.snapshot().globalKillSwitch) throw new SandboxBrokerError("kill_switch_active");
      order = await input.adapter.submitSandboxOrder(preview);
      this.stage(stages, "sandbox_submit", order.status === "rejected" ? "rejected" : "accepted", order.reason, correlationId, {
        orderId: order.orderId,
        requestedUnits: order.requestedUnits,
        filledUnits: order.filledUnits,
        remainingUnits: order.remainingUnits,
      });
      if (order.status === "rejected") throw new SandboxBrokerError("order_rejected", order.reason ?? undefined);

      order = await input.adapter.getOrderStatus(order.orderId);
      this.stage(stages, "order_status", "completed", order.reason, correlationId, { orderId: order.orderId, status: order.status });

      const positions = await input.adapter.getOpenPositions();
      this.stage(stages, "position_monitor", "completed", null, correlationId, { positionCount: positions.length });

      const journalEntry = {
        id: randomUUID(),
        correlationId,
        signal: input.signal,
        request: input.request,
        provider: input.adapter.id,
        preview,
        order,
        openPositionCount: positions.length,
        stages: stages.map((stage) => ({ ...stage })),
        createdAt: new Date().toISOString(),
        environment: input.adapter.environment,
        productionOrderSubmissionEnabled: false as const,
      };
      this.journalEntries.push(journalEntry);
      this.stage(stages, "journal_entry", "created", null, correlationId, { journalEntryId: journalEntry.id });
      journalEntry.stages = stages.map((stage) => ({ ...stage }));
      this.completeEvent(input.userId, correlationId, input.adapter.id, order, true);
      this.metrics.recordOrder(true);
      strategyEvidenceStore.recordSandboxTrade({
        strategyId: input.request.strategyId,
        symbol: input.request.instrument,
        summary: `Sandbox ${order.status} via ${input.adapter.id}`,
        outcome: order.status,
        timestamp: new Date().toISOString(),
        regime: "sandbox",
        timeframe: null,
        metadata: {
          preview,
          order,
          stages: stages.map((stage) => ({ ...stage })),
          signal: input.signal,
          riskPrecheck: input.riskContext,
          confirmationAccepted: true,
        },
      });
      return { status: "completed" as const, correlationId, preview, order, positions, stages, journalEntry };
    } catch (error) {
      const failure = error instanceof SandboxBrokerError
        ? error
        : new SandboxBrokerError("order_rejected", error instanceof Error ? error.message : "Sandbox order flow failed");
      if (!stages.some((stage) => stage.status === "rejected")) {
        const nextStage = preview ? "sandbox_submit" : "order_preview";
        this.stage(stages, nextStage, "rejected", failure.message, correlationId, { code: failure.code });
      }
      this.completeEvent(input.userId, correlationId, input.adapter.id, order, false, failure);
      this.metrics.recordOrder(false);
      strategyEvidenceStore.recordSandboxTrade({
        strategyId: input.request.strategyId,
        symbol: input.request.instrument,
        summary: `Sandbox rejected: ${failure.message}`,
        outcome: "rejected",
        timestamp: new Date().toISOString(),
        regime: "sandbox",
        timeframe: null,
        metadata: {
          preview,
          order,
          stages: stages.map((stage) => ({ ...stage })),
          signal: input.signal,
          riskPrecheck: input.riskContext,
          failure: { code: failure.code, message: failure.message },
        },
      });
      return {
        status: "rejected" as const,
        correlationId,
        code: failure.code,
        reason: failure.message,
        preview,
        order,
        stages,
        productionOrderSubmissionEnabled: false as const,
      };
    }
  }

  journal() {
    return [...this.journalEntries].reverse();
  }

  private failure(stages: SandboxFlowStage[], stage: SandboxFlowStage["stage"], reason: string, correlationId: string) {
    this.stage(stages, stage, "rejected", reason, correlationId);
    return new SandboxBrokerError("order_rejected", reason);
  }

  private stage(
    stages: SandboxFlowStage[],
    stage: SandboxFlowStage["stage"],
    status: SandboxFlowStage["status"],
    reason: string | null,
    correlationId: string,
    detail: Record<string, unknown> = {},
  ) {
    const entry = { stage, status, reason, createdAt: new Date().toISOString() };
    stages.push(entry);
    this.audit.append({
      action: `sandbox.flow.${stage}`,
      outcome: status === "rejected" ? "rejected" : status === "created" ? "created" : "accepted",
      correlationId,
      detail: { ...detail, reason, productionOrderSubmissionEnabled: false },
    });
    return entry;
  }

  private completeEvent(
    userId: string,
    correlationId: string,
    provider: string,
    order: SandboxOrderResult | null,
    success: boolean,
    failure?: SandboxBrokerError,
  ) {
    this.events.append({
      type: "sandbox.order_completed",
      userId,
      sourceService: "sandbox-order-flow",
      correlationId,
      payload: {
        provider,
        success,
        orderId: order?.orderId ?? null,
        orderStatus: order?.status ?? null,
        failureCode: failure?.code ?? null,
        failureReason: failure?.message ?? null,
        productionOrderSubmissionEnabled: false,
      },
    });
  }
}

export const sandboxOrderFlowService = new SandboxOrderFlowService();
