import { z } from "zod";
import { orderRequestSchema } from "./domain";
import { finalConfirmationService, LIVE_CONFIRMATION_PHRASE } from "./finalConfirmation";
import { liveSafetyQuizService } from "./liveSafetyQuiz";
import { liveTradingPermissionService } from "./liveTradingPermission";
import { orderPreviewService } from "./orderPreview";
import { eventLogService } from "../eventLogService";
import { reliabilityStateStore, type ReliabilityStateStore } from "./reliabilityStateStore";
import type { SandboxBrokerAdapter } from "./sandboxAdapters";
import { sandboxBrokerAdapters } from "./sandboxAdapters";
import { executionRiskService } from "./riskControls";

export const livePermissionRequestSchema = z.object({
  userId: z.string().min(1),
  proficiencyScore: z.number().min(0).max(100),
  requiredProficiencyScore: z.number().min(0).max(100).default(80),
  complianceDisclosureAcknowledged: z.boolean(),
  accountRiskProfileCompleted: z.boolean(),
  brokerConnectionVerified: z.boolean(),
  accountMode: z.enum(["paper", "sandbox", "live"]),
  expectedAccountMode: z.enum(["sandbox", "live"]),
  maxDailyLossConfigured: z.boolean(),
  maxTradeRiskConfigured: z.boolean(),
  killSwitchArmed: z.boolean(),
  strategyValidationVerdict: z.enum(["reject", "paper_only", "watchlist", "supervised_live_candidate"]),
  emergencyClosePolicyAccepted: z.boolean(),
  brokerCredentialsEncrypted: z.boolean(),
  sessionMfaVerified: z.boolean().optional(),
});

export const controlledPreviewRequestSchema = z.object({
  request: orderRequestSchema,
  accountEquity: z.number().positive(),
  currentPortfolioExposure: z.number().nonnegative(),
  estimatedSpread: z.number().nonnegative(),
  commissionRate: z.number().nonnegative(),
  estimatedSlippageRate: z.number().nonnegative(),
  invalidationRule: z.string().min(1),
  provider: z.enum(["oanda_sandbox", "metatrader_demo", "generic_rest_sandbox"]),
});

export const finalConfirmationRequestSchema = z.object({
  orderPreviewId: z.string().uuid(),
  userId: z.string().min(1),
  brokerAccountId: z.string().min(1),
  riskSummaryHash: z.string().length(64),
  confirmationPhrase: z.string(),
  currentTimestamp: z.string().datetime(),
});

export const sandboxSubmitRequestSchema = z.object({
  provider: z.enum(["oanda", "metatrader", "genericRest"]),
  orderPreviewId: z.string().uuid(),
  confirmationId: z.string().uuid(),
  userId: z.string().min(1),
});

type QuizResult = ReturnType<typeof liveSafetyQuizService.grade>;
type Permission = ReturnType<typeof liveTradingPermissionService.evaluate>;
type Preview = ReturnType<typeof orderPreviewService.create>;
type Confirmation = ReturnType<typeof finalConfirmationService.confirm>;
type WorkflowStoreEntry =
  | { kind: "quiz"; userId: string; result: QuizResult }
  | { kind: "permission"; userId: string; permission: Permission }
  | { kind: "preview"; preview: Preview; request: z.infer<typeof orderRequestSchema> }
  | { kind: "confirmation"; confirmation: Confirmation }
  | { kind: "meta"; latestPreviewId: string | null; latestConfirmationId: string | null };

export type ControlledLiveWorkflowSnapshot = {
  quizPassed: boolean;
  quizExpiresAt: string | null;
  permission: Permission | null;
  latestPreview: Preview | null;
  latestConfirmation: Confirmation | null;
  previewCount: number;
  confirmationCount: number;
  requiredConfirmationPhrase: string;
  productionLiveSubmissionAllowed: false;
};

export type ControlledLiveWorkflowHistoryEntry = {
  id: string;
  type: "controlled_live.quiz_recorded" | "controlled_live.permission_evaluated" | "controlled_live.preview_created" | "controlled_live.confirmation_recorded" | "controlled_live.sandbox_submitted";
  userId: string;
  correlationId: string;
  summary: string;
  detail: Record<string, unknown>;
  durable: boolean;
  createdAt: string;
};

type ControlledLiveWorkflowEventInput = {
  type: ControlledLiveWorkflowHistoryEntry["type"];
  userId: string;
  correlationId: string;
  summary: string;
  detail: Record<string, unknown>;
};

export type ControlledLiveWorkflowHistoryFilter = {
  limit?: number;
  userId?: string | null;
  previewId?: string | null;
  correlationId?: string | null;
};

export class ControlledLiveWorkflowService {
  private quizResults = new Map<string, QuizResult>();
  private permissions = new Map<string, Permission>();
  private previews = new Map<string, { preview: Preview; request: z.infer<typeof orderRequestSchema> }>();
  private confirmations = new Map<string, Confirmation>();

  constructor(private readonly stateStore: ReliabilityStateStore = reliabilityStateStore) {}

  gradeQuiz(userId: string, answers: Record<string, number>, now = new Date()) {
    const result = liveSafetyQuizService.grade(answers, now);
    this.quizResults.set(userId, result);
    this.stateStore.set<WorkflowStoreEntry>("controlled_live_workflow", quizKey(userId), { kind: "quiz", userId, result });
    this.appendWorkflowEvent({
      type: "controlled_live.quiz_recorded",
      userId,
      correlationId: quizCorrelationId(userId),
      summary: `Quiz ${result.passed ? "passed" : "failed"} with score ${result.score}`,
      detail: { userId, score: result.score, passed: result.passed, expiresAt: result.expiresAt, questionCount: result.questionCount },
    });
    return result;
  }

  evaluatePermission(input: z.infer<typeof livePermissionRequestSchema>, now = new Date()) {
    const parsed = livePermissionRequestSchema.parse(input);
    const quiz = this.getQuiz(parsed.userId);
    const quizPassed = Boolean(quiz?.passed && Date.parse(quiz.expiresAt) >= now.getTime());
    const permission = liveTradingPermissionService.evaluate({
      ...parsed,
      liveSafetyQuizPassed: quizPassed,
      killSwitchTriggered: executionRiskService.snapshot().globalKillSwitch,
    }, now);
    this.permissions.set(parsed.userId, permission);
    this.stateStore.set<WorkflowStoreEntry>("controlled_live_workflow", permissionKey(parsed.userId), {
      kind: "permission",
      userId: parsed.userId,
      permission,
    });
    this.appendWorkflowEvent({
      type: "controlled_live.permission_evaluated",
      userId: parsed.userId,
      correlationId: permissionCorrelationId(parsed.userId),
      summary: `Permission ${permission.allowed ? "allowed" : "blocked"}`,
      detail: {
        userId: parsed.userId,
        allowed: permission.allowed,
        missingRequirements: permission.missingRequirements,
        expirationTimestamp: permission.expirationTimestamp,
      },
    });
    return permission;
  }

  createPreview(input: z.infer<typeof controlledPreviewRequestSchema>, now = new Date()) {
    const parsed = controlledPreviewRequestSchema.parse(input);
    const preview = orderPreviewService.create({ ...parsed, environment: "sandbox" }, now);
    this.previews.set(preview.id, { preview, request: parsed.request });
    this.stateStore.set<WorkflowStoreEntry>("controlled_live_workflow", previewKey(preview.id), {
      kind: "preview",
      preview,
      request: parsed.request,
    });
    this.persistMeta({ latestPreviewId: preview.id });
    this.appendWorkflowEvent({
      type: "controlled_live.preview_created",
      userId: "controlled-live-workflow",
      correlationId: parsed.request.correlationId,
      summary: `Preview created for ${preview.instrument} ${preview.side} ${preview.quantity}`,
      detail: {
        previewId: preview.id,
        strategyId: preview.strategyId,
        instrument: preview.instrument,
        side: preview.side,
        riskAsPctOfAccount: preview.riskAsPctOfAccount,
        expiresAt: preview.expiresAt,
      },
    });
    return preview;
  }

  confirm(input: z.infer<typeof finalConfirmationRequestSchema>, now = new Date()) {
    const parsed = finalConfirmationRequestSchema.parse(input);
    const stored = this.getPreviewRecord(parsed.orderPreviewId);
    if (!stored) throw new Error("Order preview not found");
    const confirmation = finalConfirmationService.confirm({
      ...parsed,
      previewExpiresAt: stored.preview.expiresAt,
      expectedRiskSummaryHash: stored.preview.riskSummaryHash,
    }, now);
    this.confirmations.set(confirmation.id, confirmation);
    this.stateStore.set<WorkflowStoreEntry>("controlled_live_workflow", confirmationKey(confirmation.id), {
      kind: "confirmation",
      confirmation,
    });
    this.persistMeta({ latestConfirmationId: confirmation.id });
    this.appendWorkflowEvent({
      type: "controlled_live.confirmation_recorded",
      userId: parsed.userId,
      correlationId: parsed.orderPreviewId,
      summary: `Confirmation ${confirmation.accepted ? "accepted" : "rejected"}`,
      detail: {
        confirmationId: confirmation.id,
        orderPreviewId: parsed.orderPreviewId,
        accepted: confirmation.accepted,
        reasons: confirmation.reasons,
      },
    });
    return confirmation;
  }

  async submitSandbox(input: z.infer<typeof sandboxSubmitRequestSchema>) {
    const parsed = sandboxSubmitRequestSchema.parse(input);
    const stored = this.getPreviewRecord(parsed.orderPreviewId);
    if (!stored) throw new Error("Order preview not found");
    const confirmation = this.getConfirmation(parsed.confirmationId);
    if (!confirmation) throw new Error("Final confirmation not found");
    const permission = this.getPermission(parsed.userId);
    if (!permission) throw new Error("Live permission not found");
    const adapter: SandboxBrokerAdapter = sandboxBrokerAdapters[parsed.provider];
    const order = await adapter.submitSandboxOrder({
      request: stored.request,
      preview: stored.preview,
      permission,
      confirmation,
    });
    this.appendWorkflowEvent({
      type: "controlled_live.sandbox_submitted",
      userId: parsed.userId,
      correlationId: parsed.orderPreviewId,
      summary: `Sandbox order ${order.status}`,
      detail: {
        provider: parsed.provider,
        orderId: order.id,
        status: order.status,
        reason: "reason" in order ? (order as Record<string, unknown>).reason ?? null : null,
      },
    });
    return order;
  }

  snapshot(userId = "demo-user"): ControlledLiveWorkflowSnapshot {
    const quiz = this.getQuiz(userId);
    const permission = this.getPermission(userId);
    const meta = this.getMeta();
    const latestPreview = meta?.latestPreviewId ? this.getPreviewRecord(meta.latestPreviewId)?.preview ?? null : this.getLatestPreview();
    const latestConfirmation = meta?.latestConfirmationId ? this.getConfirmation(meta.latestConfirmationId) ?? null : this.getLatestConfirmation();
    return {
      quizPassed: Boolean(quiz?.passed),
      quizExpiresAt: quiz?.expiresAt ?? null,
      permission: permission ?? null,
      latestPreview,
      latestConfirmation,
      previewCount: this.listByKind("preview").length,
      confirmationCount: this.listByKind("confirmation").length,
      requiredConfirmationPhrase: LIVE_CONFIRMATION_PHRASE,
      productionLiveSubmissionAllowed: false as const,
    };
  }

  private getQuiz(userId: string) {
    if (this.quizResults.has(userId)) return this.quizResults.get(userId) ?? null;
    const entry = this.readStoredEntry("quiz", userId);
    return entry?.kind === "quiz" ? entry.result : null;
  }

  private getPermission(userId: string) {
    if (this.permissions.has(userId)) return this.permissions.get(userId) ?? null;
    const entry = this.readStoredEntry("permission", userId);
    return entry?.kind === "permission" ? entry.permission : null;
  }

  private getPreviewRecord(previewId: string) {
    if (this.previews.has(previewId)) return this.previews.get(previewId) ?? null;
    const entry = this.readStoredEntry("preview", previewId);
    return entry?.kind === "preview" ? entry : null;
  }

  private getConfirmation(confirmationId: string) {
    if (this.confirmations.has(confirmationId)) return this.confirmations.get(confirmationId) ?? null;
    const entry = this.readStoredEntry("confirmation", confirmationId);
    return entry?.kind === "confirmation" ? entry.confirmation : null;
  }

  private getMeta() {
    const entry = this.readStoredEntry("meta", "current");
    return entry?.kind === "meta" ? entry : null;
  }

  private getLatestPreview() {
    const previews = this.stateStore.list<WorkflowStoreEntry>("controlled_live_workflow")
      .filter((item): item is Extract<WorkflowStoreEntry, { kind: "preview" }> => item.kind === "preview");
    return previews.length > 0 ? previews[previews.length - 1].preview : null;
  }

  private getLatestConfirmation() {
    const confirmations = this.stateStore.list<WorkflowStoreEntry>("controlled_live_workflow")
      .filter((item): item is Extract<WorkflowStoreEntry, { kind: "confirmation" }> => item.kind === "confirmation");
    return confirmations.length > 0 ? confirmations[confirmations.length - 1].confirmation : null;
  }

  private listByKind(kind: WorkflowStoreEntry["kind"]) {
    return this.stateStore.list<WorkflowStoreEntry>("controlled_live_workflow").filter((item): item is Extract<WorkflowStoreEntry, { kind: typeof kind }> => item.kind === kind);
  }

  private readStoredEntry(kind: string, key: string) {
    const entry = this.stateStore.get<WorkflowStoreEntry>("controlled_live_workflow", compoundKey(kind, key));
    return entry ?? null;
  }

  private persistMeta(meta: { latestPreviewId?: string | null; latestConfirmationId?: string | null }) {
    const current = this.getMeta() ?? { latestPreviewId: null, latestConfirmationId: null };
    this.stateStore.set<WorkflowStoreEntry>("controlled_live_workflow", "meta:current", {
      kind: "meta",
      latestPreviewId: meta.latestPreviewId ?? current.latestPreviewId,
      latestConfirmationId: meta.latestConfirmationId ?? current.latestConfirmationId,
    });
  }

  async history(filter: ControlledLiveWorkflowHistoryFilter = {}): Promise<ControlledLiveWorkflowHistoryEntry[]> {
    const limit = filter.limit ?? 25;
    const events = await eventLogService.durableList(500);
    const health = eventLogService.persistenceHealth();
    const durable = Boolean(health.configured && health.store?.status === "healthy");
    return events
      .filter((event) => this.matchesHistoryFilter(event, filter))
      .map((event) => ({
        id: event.id,
        type: event.type as ControlledLiveWorkflowHistoryEntry["type"],
        userId: event.userId,
        correlationId: event.correlationId,
        summary: typeof event.payload?.summary === "string" ? event.payload.summary : event.type,
        detail: event.payload,
        durable,
        createdAt: event.createdAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  private appendWorkflowEvent(input: ControlledLiveWorkflowEventInput) {
    const createdAt = new Date().toISOString();
    eventLogService.append({
      type: input.type,
      userId: input.userId,
      sourceService: "controlled-live-workflow",
      correlationId: input.correlationId,
      payload: {
        summary: input.summary,
        detail: input.detail,
      },
      createdAt,
    });
  }

  private matchesHistoryFilter(event: Awaited<ReturnType<typeof eventLogService.durableList>>[number], filter: ControlledLiveWorkflowHistoryFilter) {
    if (event.sourceService !== "controlled-live-workflow") return false;

    switch (event.type) {
      case "controlled_live.quiz_recorded":
      case "controlled_live.permission_evaluated":
        return !filter.userId || event.userId === filter.userId;
      case "controlled_live.preview_created":
        return !filter.correlationId || event.correlationId === filter.correlationId;
      case "controlled_live.confirmation_recorded":
      case "controlled_live.sandbox_submitted": {
        const detail = event.payload?.detail && typeof event.payload.detail === "object"
          ? (event.payload.detail as Record<string, unknown>)
          : {};
        const previewMatch = !filter.previewId
          || event.correlationId === filter.previewId
          || detail.orderPreviewId === filter.previewId
          || detail.previewId === filter.previewId;
        const userMatch = !filter.userId || event.userId === filter.userId;
        return previewMatch && userMatch;
      }
      default:
        return false;
    }
  }
}

export const controlledLiveWorkflowService = new ControlledLiveWorkflowService();

function quizKey(userId: string) {
  return `quiz:${userId}`;
}

function permissionKey(userId: string) {
  return `permission:${userId}`;
}

function previewKey(previewId: string) {
  return `preview:${previewId}`;
}

function confirmationKey(confirmationId: string) {
  return `confirmation:${confirmationId}`;
}

function compoundKey(kind: string, key: string) {
  return `${kind}:${key}`;
}

function quizCorrelationId(userId: string) {
  return `controlled-live-quiz:${userId}`;
}

function permissionCorrelationId(userId: string) {
  return `controlled-live-permission:${userId}`;
}
