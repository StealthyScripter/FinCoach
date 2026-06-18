import assert from "node:assert/strict";
import { AutomationLevelService } from "./execution/automationLevels";
import { ExecutionEmergencyState, EmergencyControlService } from "./execution/emergencyControls";
import { FinalConfirmationService, LIVE_CONFIRMATION_PHRASE } from "./execution/finalConfirmation";
import { selectLiveReadinessPanel } from "./execution/executionCenter";
import { LIVE_SAFETY_QUIZ, LiveSafetyQuizService } from "./execution/liveSafetyQuiz";
import { LiveTradingPermissionService } from "./execution/liveTradingPermission";
import { LiveReadinessReportService } from "./execution/liveReadinessReport";
import { OrderPreviewService } from "./execution/orderPreview";
import { ExecutionRiskService } from "./execution/riskControls";
import { OandaSandboxAdapter } from "./execution/sandboxAdapters";

const now = new Date();
const quizService = new LiveSafetyQuizService();
const correctAnswers = Object.fromEntries(LIVE_SAFETY_QUIZ.map((question) => [question.id, question.correctChoice]));
const passedQuiz = quizService.grade(correctAnswers, now);
assert.equal(passedQuiz.passed, true);
assert.equal(passedQuiz.questionCount, 11);
assert.deepEqual(new Set(LIVE_SAFETY_QUIZ.map((question) => question.topic)).size, 11);
const failedQuiz = quizService.grade({}, now);
assert.equal(failedQuiz.passed, false);

const permissionService = new LiveTradingPermissionService();
const permissionInput = {
  userId: "user-v3",
  proficiencyScore: 92,
  requiredProficiencyScore: 80,
  complianceDisclosureAcknowledged: true,
  accountRiskProfileCompleted: true,
  brokerConnectionVerified: true,
  accountMode: "sandbox" as const,
  expectedAccountMode: "sandbox" as const,
  maxDailyLossConfigured: true,
  maxTradeRiskConfigured: true,
  killSwitchArmed: true,
  killSwitchTriggered: false,
  strategyValidationVerdict: "supervised_live_candidate" as const,
  liveSafetyQuizPassed: true,
  emergencyClosePolicyAccepted: true,
  brokerCredentialsEncrypted: true,
  sessionMfaVerified: true,
};
const permission = permissionService.evaluate(permissionInput, now);
assert.equal(permission.allowed, true);
assert.equal(permission.productionLiveSubmissionAllowed, false);
assert.equal(permissionService.evaluate({ ...permissionInput, liveSafetyQuizPassed: false }, now).blocked, true);
assert.ok(permissionService.evaluate({ ...permissionInput, accountMode: "live" }, now).missingRequirements.some((item) => item.includes("sandbox")));

const request = {
  strategyId: "trend-v3",
  instrument: "EUR/USD",
  side: "buy" as const,
  type: "market" as const,
  units: 10_000,
  price: 1.1,
  stopLoss: 1.095,
  takeProfit: 1.11,
  mode: "supervised_live" as const,
  explicitUserConfirmation: true,
  correlationId: "controlled-live-v3",
};
const previewService = new OrderPreviewService();
const preview = previewService.create({
  request,
  accountEquity: 100_000,
  currentPortfolioExposure: 20_000,
  estimatedSpread: 0.0001,
  commissionRate: 0.00002,
  estimatedSlippageRate: 0.00005,
  invalidationRule: "Close below the London range low",
  provider: "oanda_sandbox",
  environment: "sandbox",
}, now);
assert.equal(preview.instrument, "EUR/USD");
assert.equal(preview.quantity, 10_000);
assert.ok(preview.notionalValue > 0);
assert.ok(preview.estimatedMargin > 0);
assert.ok(preview.maxLossEstimate > 0);
assert.equal(preview.confirmationText, LIVE_CONFIRMATION_PHRASE);
assert.equal(preview.submissionAllowed, false);

const confirmationService = new FinalConfirmationService();
const confirmation = confirmationService.confirm({
  orderPreviewId: preview.id,
  previewExpiresAt: preview.expiresAt,
  userId: "user-v3",
  brokerAccountId: "oanda-sandbox-account",
  riskSummaryHash: preview.riskSummaryHash,
  expectedRiskSummaryHash: preview.riskSummaryHash,
  confirmationPhrase: LIVE_CONFIRMATION_PHRASE,
  currentTimestamp: now.toISOString(),
}, now);
assert.equal(confirmation.accepted, true);
assert.equal(confirmation.singleUse, true);
assert.equal(confirmationService.confirm({
  orderPreviewId: preview.id,
  previewExpiresAt: preview.expiresAt,
  userId: "user-v3",
  brokerAccountId: "oanda-sandbox-account",
  riskSummaryHash: preview.riskSummaryHash,
  expectedRiskSummaryHash: preview.riskSummaryHash,
  confirmationPhrase: "I accept",
  currentTimestamp: now.toISOString(),
}, now).accepted, false);

const sandbox = new OandaSandboxAdapter();
assert.equal((await sandbox.syncAccount()).mode, "sandbox");
assert.equal((await sandbox.lookupInstrument("EUR_USD"))?.symbol, "EUR/USD");
const sandboxPreview = await sandbox.previewOrder({
  request,
  accountEquity: 100_000,
  currentPortfolioExposure: 0,
  estimatedSpread: 0.0001,
  commissionRate: 0,
  estimatedSlippageRate: 0.00005,
  invalidationRule: "Breakout closes back inside range",
  provider: sandbox.id,
  environment: "sandbox",
});
const sandboxConfirmation = confirmationService.confirm({
  orderPreviewId: sandboxPreview.id,
  previewExpiresAt: sandboxPreview.expiresAt,
  userId: "user-v3",
  brokerAccountId: "oanda-sandbox-account",
  riskSummaryHash: sandboxPreview.riskSummaryHash,
  expectedRiskSummaryHash: sandboxPreview.riskSummaryHash,
  confirmationPhrase: LIVE_CONFIRMATION_PHRASE,
  currentTimestamp: new Date().toISOString(),
});
const sandboxOrder = await sandbox.submitSandboxOrder({ request, preview: sandboxPreview, permission, confirmation: sandboxConfirmation });
assert.equal(sandboxOrder.status, "sandbox_filled");
assert.equal((await sandbox.submitSandboxOrder({ request, preview: sandboxPreview, permission, confirmation: sandboxConfirmation })).status, "sandbox_rejected");
assert.equal(sandbox.productionSubmitEnabled, false);
assert.equal((await sandbox.getOrderStatus(sandboxOrder.id))?.status, "sandbox_filled");
assert.equal((await sandbox.syncPositions()).length, 1);
assert.equal((await sandbox.disconnect()).disconnected, true);

let fakePositions = 3;
let disconnected = false;
const localRisk = new ExecutionRiskService();
const localAutomation = new AutomationLevelService(4);
const localEmergencyState = new ExecutionEmergencyState();
const emergency = new EmergencyControlService(localRisk, localAutomation, [{
  id: "fake-paper",
  closeAllPositions: async () => {
    const closed = fakePositions;
    fakePositions = 0;
    return { closed };
  },
  disconnect: async () => {
    disconnected = true;
    return { disconnected };
  },
}], localEmergencyState);
const emergencyReport = await emergency.activate("user-v3", "Test emergency", now);
assert.equal(emergencyReport.globalKillSwitchTriggered, true);
assert.equal(emergencyReport.paperPositionsClosed, 3);
assert.equal(emergencyReport.automationLevel, 0);
assert.equal(emergencyReport.livePermissionRevoked, true);
assert.equal(emergencyReport.signalsFrozen, true);
assert.equal(disconnected, true);

const reportService = new LiveReadinessReportService();
const sandboxReport = reportService.generate({
  permission,
  strategyReady: true,
  brokerReady: true,
  riskPrecheckApproved: true,
  riskLimitsConfigured: true,
  credentialsEncrypted: true,
  mfaVerified: true,
  complianceReady: true,
  auditTrailComplete: true,
  orderPreviewReady: true,
  finalConfirmationReady: true,
  killSwitchArmed: true,
  sandboxSubmitAvailable: true,
  productionFeatureEnabled: false,
}, now);
assert.equal(sandboxReport.verdict, "sandbox_only");
assert.equal(reportService.generate({
  permission,
  strategyReady: true,
  brokerReady: true,
  riskPrecheckApproved: true,
  riskLimitsConfigured: true,
  credentialsEncrypted: true,
  mfaVerified: true,
  complianceReady: true,
  auditTrailComplete: true,
  orderPreviewReady: true,
  finalConfirmationReady: true,
  killSwitchArmed: true,
  sandboxSubmitAvailable: true,
  productionFeatureEnabled: true,
}, now).verdict, "supervised_live_ready");
const blockedReport = reportService.generate({
  permission: permissionService.blockedDefault("blocked-user", now),
  strategyReady: false,
  brokerReady: false,
  riskPrecheckApproved: false,
  riskLimitsConfigured: false,
  credentialsEncrypted: false,
  mfaVerified: false,
  complianceReady: false,
  auditTrailComplete: false,
  orderPreviewReady: false,
  finalConfirmationReady: false,
  killSwitchArmed: false,
  sandboxSubmitAvailable: true,
  productionFeatureEnabled: false,
}, now);
assert.equal(blockedReport.verdict, "blocked");

const panel = selectLiveReadinessPanel(sandboxReport, { maxDailyLoss: 250, maxRiskPerTradePct: 0.5 }, false);
assert.deepEqual(Object.keys(panel), ["readinessVerdict", "missingRequirements", "activeRiskLimits", "killSwitchState", "nextRequiredAction"]);
assert.equal(panel.readinessVerdict, "sandbox_only");
assert.equal(panel.killSwitchState, "armed");

console.log("execution v3 controlled-live readiness tests passed");
