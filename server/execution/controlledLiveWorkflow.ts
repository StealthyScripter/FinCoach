import { z } from "zod";
import { orderRequestSchema } from "./domain";
import { finalConfirmationService, LIVE_CONFIRMATION_PHRASE } from "./finalConfirmation";
import { liveSafetyQuizService } from "./liveSafetyQuiz";
import { liveTradingPermissionService } from "./liveTradingPermission";
import { orderPreviewService } from "./orderPreview";
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

export class ControlledLiveWorkflowService {
  private quizResults = new Map<string, QuizResult>();
  private permissions = new Map<string, Permission>();
  private previews = new Map<string, { preview: Preview; request: z.infer<typeof orderRequestSchema> }>();
  private confirmations = new Map<string, Confirmation>();

  gradeQuiz(userId: string, answers: Record<string, number>, now = new Date()) {
    const result = liveSafetyQuizService.grade(answers, now);
    this.quizResults.set(userId, result);
    return result;
  }

  evaluatePermission(input: z.infer<typeof livePermissionRequestSchema>, now = new Date()) {
    const parsed = livePermissionRequestSchema.parse(input);
    const quiz = this.quizResults.get(parsed.userId);
    const quizPassed = Boolean(quiz?.passed && Date.parse(quiz.expiresAt) >= now.getTime());
    const permission = liveTradingPermissionService.evaluate({
      ...parsed,
      liveSafetyQuizPassed: quizPassed,
      killSwitchTriggered: executionRiskService.snapshot().globalKillSwitch,
    }, now);
    this.permissions.set(parsed.userId, permission);
    return permission;
  }

  createPreview(input: z.infer<typeof controlledPreviewRequestSchema>, now = new Date()) {
    const parsed = controlledPreviewRequestSchema.parse(input);
    const preview = orderPreviewService.create({ ...parsed, environment: "sandbox" }, now);
    this.previews.set(preview.id, { preview, request: parsed.request });
    return preview;
  }

  confirm(input: z.infer<typeof finalConfirmationRequestSchema>, now = new Date()) {
    const parsed = finalConfirmationRequestSchema.parse(input);
    const stored = this.previews.get(parsed.orderPreviewId);
    if (!stored) throw new Error("Order preview not found");
    const confirmation = finalConfirmationService.confirm({
      ...parsed,
      previewExpiresAt: stored.preview.expiresAt,
      expectedRiskSummaryHash: stored.preview.riskSummaryHash,
    }, now);
    this.confirmations.set(confirmation.id, confirmation);
    return confirmation;
  }

  async submitSandbox(input: z.infer<typeof sandboxSubmitRequestSchema>) {
    const parsed = sandboxSubmitRequestSchema.parse(input);
    const stored = this.previews.get(parsed.orderPreviewId);
    if (!stored) throw new Error("Order preview not found");
    const confirmation = this.confirmations.get(parsed.confirmationId);
    if (!confirmation) throw new Error("Final confirmation not found");
    const permission = this.permissions.get(parsed.userId);
    if (!permission) throw new Error("Live permission not found");
    const adapter: SandboxBrokerAdapter = sandboxBrokerAdapters[parsed.provider];
    return adapter.submitSandboxOrder({
      request: stored.request,
      preview: stored.preview,
      permission,
      confirmation,
    });
  }

  snapshot(userId = "demo-user") {
    const quiz = this.quizResults.get(userId);
    const permission = this.permissions.get(userId);
    return {
      quizPassed: Boolean(quiz?.passed),
      quizExpiresAt: quiz?.expiresAt ?? null,
      permission: permission ?? null,
      previewCount: this.previews.size,
      confirmationCount: this.confirmations.size,
      requiredConfirmationPhrase: LIVE_CONFIRMATION_PHRASE,
      productionLiveSubmissionAllowed: false as const,
    };
  }
}

export const controlledLiveWorkflowService = new ControlledLiveWorkflowService();
