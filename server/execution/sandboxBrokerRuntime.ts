import { z } from "zod";
import type { DemoBrokerAdapter, SandboxOrderPreview, SandboxOrderResult } from "./brokerSandbox";
import { SandboxBrokerError } from "./brokerFailures";
import { orderRequestSchema } from "./domain";
import { executionAuditLog, executionRiskService } from "./riskControls";
import { createOandaPracticeAdapterFromEnv } from "./oandaPracticeAdapter";
import { HttpMetaTraderBridgeTransport, MetaTraderHttpDemoBridgeAdapter } from "./metaTraderDemoBridge";
import { LIVE_CONFIRMATION_PHRASE } from "./finalConfirmation";
import { SubmissionIdempotencyService } from "./submissionIdempotencyService";
import { brokerReconciliationService, type TrackedSandboxOrder } from "./brokerReconciliationService";
import { sandboxExecutionMetrics } from "./sandboxMetrics";
import { eventLogService } from "../eventLogService";
import { createHash, randomUUID } from "crypto";
import { publishTelegramLifecycleAlert } from "../telegramNotificationBus";
import {
  transactionalReliabilityRepository,
  type TransactionalReliabilityRepository,
} from "./transactionalReliabilityRepository";
import { demoOnlyPolicyService } from "./demoOnlyPolicy";
import { operationalBlockerService } from "../operationalBlockerService";
import { classifyOperationalAlert, shouldSendOperatorTelegramAlert } from "../operationalAlertPolicy";
import { executionFunnelTelemetry } from "./executionFunnelTelemetry";

export const sandboxProviderSchema = z.enum(["oanda_practice", "metatrader_demo"]);
export const sandboxPreviewSchema = z.object({
  provider: sandboxProviderSchema,
  request: orderRequestSchema,
});
export const sandboxConfirmedSubmitSchema = z.object({
  provider: sandboxProviderSchema,
  previewId: z.string().uuid(),
  riskSummaryHash: z.string().length(64),
  confirmationPhrase: z.string(),
  idempotencyKey: z.string().min(8).max(200),
});
export const sandboxIdempotencyResolutionSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  decision: z.enum(["record_not_submitted", "record_broker_result"]),
  brokerResult: z.object({
    provider: sandboxProviderSchema,
    orderId: z.string().min(1),
    status: z.enum(["pending", "partially_filled", "filled", "rejected", "cancelled"]),
    reason: z.string().nullable(),
    submittedAt: z.string().datetime(),
    requestedUnits: z.number().positive().optional(),
    filledUnits: z.number().nonnegative().optional(),
    remainingUnits: z.number().nonnegative().optional(),
    averageFillPrice: z.number().nullable().optional(),
    productionOrderSubmissionEnabled: z.literal(false),
  }).optional(),
  reviewedBy: z.string().min(1),
});

export class SandboxBrokerRuntime {
  private readonly adapters = new Map<string, DemoBrokerAdapter>();
  private readonly previews = new Map<string, SandboxOrderPreview>();
  private latestOrder: SandboxOrderResult | null = null;
  private readonly idempotency = new SubmissionIdempotencyService<SandboxOrderResult>();
  private readonly trackedOrders: TrackedSandboxOrder[] = [];
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationSchedulerRunning = false;
  private reconciliationSchedulerLastError: string | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly transactionalReliability: TransactionalReliabilityRepository = transactionalReliabilityRepository,
  ) {}

  adapter(provider: z.infer<typeof sandboxProviderSchema>) {
    const existing = this.adapters.get(provider);
    if (existing) return existing;
    const adapter = provider === "oanda_practice"
      ? createOandaPracticeAdapterFromEnv(this.env)
      : this.createMetaTraderAdapter();
    this.adapters.set(provider, adapter);
    return adapter;
  }

  async preview(provider: z.infer<typeof sandboxProviderSchema>, request: z.infer<typeof orderRequestSchema>) {
    if (executionRiskService.snapshot().globalKillSwitch) throw new SandboxBrokerError("kill_switch_active");
    const adapter = this.adapter(provider);
    await this.verifyDemoOnly(adapter, "sandbox.preview", "sandbox-broker-runtime");
    const preview = await adapter.previewOrder(request);
    this.previews.set(preview.id, preview);
    return preview;
  }

  async submit(input: z.infer<typeof sandboxConfirmedSubmitSchema>) {
    const reservationId = randomUUID();
    const fingerprintInput = {
      provider: input.provider,
      previewId: input.previewId,
      riskSummaryHash: input.riskSummaryHash,
      confirmationPhrase: input.confirmationPhrase,
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex");
    const reservation = await this.transactionalReliability.reserveSubmission(
      input.idempotencyKey,
      fingerprint,
      reservationId,
    );
    if (reservation.status === "conflict") {
      throw new SandboxBrokerError("order_rejected", "Idempotency key was already used for a different submission.");
    }
    if (reservation.status === "in_doubt") {
      throw new SandboxBrokerError("order_rejected", "The prior submission outcome is unknown. Reconcile broker state before resolving this idempotency key.");
    }
    if (reservation.status === "replay") {
      return { ...reservation.result, idempotencyKey: input.idempotencyKey, replayed: true };
    }
    try {
      const submission = await this.idempotency.execute(input.idempotencyKey, fingerprintInput, async () => {
        if (executionRiskService.snapshot().globalKillSwitch) throw new SandboxBrokerError("kill_switch_active");
        const preview = this.previews.get(input.previewId);
        if (!preview || preview.provider !== input.provider) throw new SandboxBrokerError("order_rejected", "Sandbox order preview was not found.");
        if (Date.parse(preview.expiresAt) < Date.now()) throw new SandboxBrokerError("confirmation_expired");
        if (input.confirmationPhrase !== LIVE_CONFIRMATION_PHRASE) {
          throw new SandboxBrokerError("order_rejected", "Confirmation phrase does not match exactly.");
        }
        if (input.riskSummaryHash !== preview.riskSummaryHash) {
          throw new SandboxBrokerError("order_rejected", "Risk summary hash does not match the sandbox preview.");
        }
        const adapter = this.adapter(input.provider);
        await this.verifyDemoOnly(adapter, "sandbox.confirmed_submit", "sandbox-broker-runtime");
        executionFunnelTelemetry.increment("brokerSubmissionAttempted");
        const order = await adapter.submitSandboxOrder(preview);
        this.previews.delete(preview.id);
        this.latestOrder = order;
        if (order.status === "partially_filled") sandboxExecutionMetrics.recordPartialFill();
        this.trackedOrders.push({
          provider: input.provider,
          orderId: order.orderId,
          expectedStatus: order.status,
          expectedFilledUnits: order.filledUnits,
          submittedAt: order.submittedAt,
          idempotencyKey: input.idempotencyKey,
        });
        return order;
      });
      await this.transactionalReliability.completeSubmission(input.idempotencyKey, reservationId, submission.result);
      if (submission.result.status !== "rejected") {
        executionFunnelTelemetry.increment("brokerAccepted");
        void publishTelegramLifecycleAlert({
          id: `sandbox-order-${submission.result.orderId}`,
          source: "sandbox",
          eventType: "sandbox.order_submitted",
          severity: "info",
          title: "Sandbox order submitted",
          message: `${input.provider} submitted order ${submission.result.orderId} with status ${submission.result.status}.`,
          requiredActions: ["Review the sandbox order timeline", "Check broker health and fills"],
        });
      }
      if (submission.result.status === "filled" || submission.result.status === "partially_filled") {
        executionFunnelTelemetry.increment("brokerTradesConfirmed");
        void publishTelegramLifecycleAlert({
          id: `sandbox-position-opened-${submission.result.orderId}`,
          source: "sandbox",
          eventType: "sandbox.position_opened",
          severity: "info",
          title: "Sandbox position opened",
          message: `${input.provider} opened ${submission.result.orderId} with ${submission.result.filledUnits ?? 0} filled units.`,
          requiredActions: ["Track the sandbox position", "Review the execution preview"],
        });
      }
      if (submission.result.status === "rejected") {
        executionFunnelTelemetry.increment("brokerRejected");
        void this.recordOrderFailureIncident(input.provider, "order_rejected", submission.result.reason ?? "Broker rejected the order.", input.idempotencyKey);
      }
      return { ...submission.result, idempotencyKey: input.idempotencyKey, replayed: submission.replayed };
    } catch (error) {
      if (error instanceof SandboxBrokerError && ["provider_disconnected", "rate_limited"].includes(error.code)) {
        await this.transactionalReliability.markSubmissionInDoubt(input.idempotencyKey, reservationId);
      } else {
        await this.transactionalReliability.abandonSubmission(input.idempotencyKey, reservationId);
      }
      const code = error instanceof SandboxBrokerError ? error.code : "execution_service_disabled_unexpectedly";
      executionFunnelTelemetry.increment("brokerRejected");
      void this.recordOrderFailureIncident(input.provider, code, error instanceof Error ? error.message : "Sandbox order submission failed.", input.idempotencyKey);
      throw error;
    }
  }

  getLatestOrder() {
    return this.latestOrder;
  }

  async reconcile(provider: z.infer<typeof sandboxProviderSchema>, userId = "system") {
    const report = await brokerReconciliationService.reconcile(this.adapter(provider), this.trackedOrders, userId);
    await this.transactionalReliability.saveReconciliation(report);
    return report;
  }

  startReconciliationScheduler() {
    if (this.reconciliationTimer) return this.reconciliationSchedulerHealth();
    if (!reconciliationSchedulerEnabled(this.env)) return this.reconciliationSchedulerHealth();
    const intervalMs = reconciliationIntervalMs(this.env);
    this.reconciliationTimer = setInterval(() => {
      void this.runScheduledReconciliation();
    }, intervalMs);
    this.reconciliationTimer.unref?.();
    void this.runScheduledReconciliation();
    return this.reconciliationSchedulerHealth();
  }

  stopReconciliationSchedulerForTest() {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
    this.reconciliationSchedulerRunning = false;
  }

  reconciliationSchedulerHealth() {
    return {
      enabled: reconciliationSchedulerEnabled(this.env),
      active: Boolean(this.reconciliationTimer),
      running: this.reconciliationSchedulerRunning,
      intervalMs: reconciliationIntervalMs(this.env),
      providerConfigured: this.configuredProviders().oandaPractice,
      lastError: this.reconciliationSchedulerLastError,
    };
  }

  reconciliationReports() {
    return brokerReconciliationService.list();
  }

  reconciliationHealth(now = new Date()) {
    const maxAgeMs = maxReconciliationAgeMs(this.env);
    return brokerReconciliationService.health(now, maxAgeMs);
  }

  async resolveIdempotency(input: z.infer<typeof sandboxIdempotencyResolutionSchema>) {
    if (input.decision === "record_broker_result" && !input.brokerResult) {
      throw new Error("brokerResult is required when recording a broker result");
    }
    await this.transactionalReliability.resolveSubmission(
      input.idempotencyKey,
      input.decision,
      input.reviewedBy,
      input.brokerResult,
    );
    const localRecord = this.idempotencyRecords().find((record) => record.key === input.idempotencyKey);
    const resolved = localRecord?.status === "in_doubt"
      ? this.idempotency.resolveInDoubt(
          input.idempotencyKey,
          input.decision === "record_not_submitted"
            ? { allowRetry: true }
            : { result: input.brokerResult },
        )
      : input.decision === "record_broker_result"
        ? { status: "completed" as const }
        : null;
    const correlationId = `idempotency:${input.idempotencyKey}`;
    executionAuditLog.append({
      action: "sandbox.idempotency.resolve",
      outcome: "accepted",
      correlationId,
      detail: {
        idempotencyKey: input.idempotencyKey,
        decision: input.decision,
        reviewedBy: input.reviewedBy,
        brokerOrderId: input.brokerResult?.orderId ?? null,
        productionOrderSubmissionEnabled: false,
      },
    });
    eventLogService.append({
      type: "sandbox.idempotency_resolved",
      userId: input.reviewedBy,
      sourceService: "sandbox-broker-runtime",
      correlationId,
      payload: {
        idempotencyKey: input.idempotencyKey,
        decision: input.decision,
        brokerOrderId: input.brokerResult?.orderId ?? null,
        productionOrderSubmissionEnabled: false,
      },
    });
    return {
      idempotencyKey: input.idempotencyKey,
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      status: resolved?.status ?? "retry_authorized",
      productionOrderSubmissionEnabled: false as const,
    };
  }

  idempotencyRecords() {
    return this.idempotency.list();
  }

  transactionalReliabilityHealth() {
    return this.transactionalReliability.health();
  }

  configuredProviders() {
    return {
      oandaPractice: Boolean(
        this.env.OANDA_API_TOKEN
        && this.env.OANDA_ACCOUNT_ID
        && this.env.OANDA_ENV?.trim().toLowerCase() === "practice"
      ),
      metaTraderDemo: Boolean(this.env.METATRADER_DEMO_BRIDGE_URL),
      productionOrderSubmissionEnabled: false as const,
    };
  }

  private createMetaTraderAdapter() {
    const url = this.env.METATRADER_DEMO_BRIDGE_URL?.trim();
    if (!url) throw new SandboxBrokerError("provider_disconnected", "METATRADER_DEMO_BRIDGE_URL is not configured.");
    return new MetaTraderHttpDemoBridgeAdapter(new HttpMetaTraderBridgeTransport(url));
  }

  private async recordOrderFailureIncident(provider: z.infer<typeof sandboxProviderSchema>, code: string, reason: string, idempotencyKey: string) {
    const category = classifyOperationalAlert({ code, broker: provider, environment: provider === "oanda_practice" ? "practice" : "demo", expected: false });
    if (!shouldSendOperatorTelegramAlert({ code, category, broker: provider, expected: false })) return;
    await operationalBlockerService.record({
      kind: "dependency",
      code,
      title: "Broker order processing failed",
      whatBlocked: "sandbox/practice order submission",
      reason,
      currentValue: { provider, idempotencyKey: "[REDACTED]" },
      limitValue: "broker order accepted and discoverable",
      scope: { component: provider },
      expected: false,
      action: "Inspect broker configuration, account access, provider health, and reconciliation status.",
      effect: "Passing practice candidates cannot be reliably submitted until broker state recovers.",
      severity: "critical",
      alertCategory: category === "EXPECTED_POLICY_REJECTION" ? "EXECUTION_INFRASTRUCTURE_FAILURE" : category,
    });
  }

  private async verifyDemoOnly(adapter: DemoBrokerAdapter, attemptedAction: string, source: string) {
    const account = await adapter.getAccountSummary();
    return demoOnlyPolicyService.assertAllowed({
      provider: adapter.id,
      accountMode: account.mode,
      verificationSource: `${adapter.id}.getAccountSummary`,
      attemptedAction,
      actor: "system",
      source,
      metadata: {
        accountId: account.accountId,
        productionOrderSubmissionEnabled: adapter.productionOrderSubmissionEnabled,
      },
    });
  }

  private async runScheduledReconciliation() {
    if (this.reconciliationSchedulerRunning) return;
    if (!this.configuredProviders().oandaPractice) return;
    this.reconciliationSchedulerRunning = true;
    try {
      await this.reconcile("oanda_practice", "broker-reconciliation-scheduler");
      this.reconciliationSchedulerLastError = null;
    } catch (error) {
      this.reconciliationSchedulerLastError = error instanceof Error ? error.message : "Scheduled broker reconciliation failed.";
    } finally {
      this.reconciliationSchedulerRunning = false;
    }
  }
}

export const sandboxBrokerRuntime = new SandboxBrokerRuntime();

function maxReconciliationAgeMs(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.FINCOACH_BROKER_RECONCILIATION_MAX_AGE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60_000;
}

function reconciliationIntervalMs(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.FINCOACH_BROKER_RECONCILIATION_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60_000;
}

function reconciliationSchedulerEnabled(env: NodeJS.ProcessEnv) {
  return env.FINCOACH_BROKER_RECONCILIATION_ENABLED?.trim().toLowerCase() !== "false";
}
