import assert from "node:assert/strict";
import { marketPilotOverviewSchema, type ResearchReport } from "@shared/schema";
import { createSeedOverview, createStorage, MemStorage } from "./storage";

const seed = createSeedOverview();
assert.doesNotThrow(() => marketPilotOverviewSchema.parse(seed));
assert.equal(seed.user.liveTradingEnabled, false);
assert.equal(seed.progression.liveTradingUnlock, "locked");
assert.equal(seed.complianceProfile.disclosuresAccepted, false);

const previousUrl = process.env.DATABASE_URL;
const previousMode = process.env.MARKETPILOT_STORAGE;
delete process.env.DATABASE_URL;
delete process.env.MARKETPILOT_STORAGE;

const storage = createStorage();
assert.ok(storage instanceof MemStorage);

const complianceProfile = await storage.getComplianceProfile();
assert.equal(complianceProfile.disclosuresAccepted, false);
assert.ok(complianceProfile.requiredDisclosures.some((item) => /AI explanations/.test(item)));
const acknowledgedCompliance = await storage.acknowledgeCompliance({
  accepted: true,
  disclosureVersion: "marketpilot-risk-v1",
  userConfirmation: "I understand that MarketPilot AI can be wrong and I remain responsible for decisions.",
});
assert.equal(acknowledgedCompliance.disclosuresAccepted, true);
assert.ok(acknowledgedCompliance.acceptedAt);
const overviewAfterCompliance = await storage.getMarketPilotOverview();
assert.equal(overviewAfterCompliance.auditLogs[0].action, "acknowledged_compliance_disclosures");

const report: ResearchReport = {
  ...seed.researchReports[0],
  id: "report-storage-test",
  title: "Storage Persistence Test",
};
await storage.saveResearchReport(report);
const overviewAfterSave = await storage.getMarketPilotOverview();
assert.equal(overviewAfterSave.researchReports[0].id, "report-storage-test");
assert.equal(overviewAfterSave.auditLogs[0].action, "generated_research_report");

await assert.rejects(
  () => storage.fillPaperTrade("ticket-sgov-rebalance", {
    complianceAcknowledged: true,
    userConfirmation: "I acknowledge this paper fill.",
  }),
  /Paper fill requires an order preview first/,
);

const preview = await storage.createOrderPreview("ticket-sgov-rebalance");
assert.equal(preview.tradeTicketId, "ticket-sgov-rebalance");
assert.equal(preview.liveExecutionBlocked, true);
const overviewAfterPreview = await storage.getMarketPilotOverview();
assert.equal(overviewAfterPreview.auditLogs[0].action, "generated_order_preview");

await assert.rejects(
  () => storage.fillPaperTrade("ticket-sgov-rebalance", {
    complianceAcknowledged: true,
    userConfirmation: "I acknowledge this paper fill.",
    previewId: "wrong-preview",
  }),
  /Paper fill acknowledgement does not match the order preview/,
);

const fill = await storage.fillPaperTrade("ticket-sgov-rebalance", {
  complianceAcknowledged: true,
  userConfirmation: "I acknowledge this paper fill.",
  previewId: preview.id,
});
assert.equal(fill.ticket.status, "paper_filled");
const overviewAfterFill = await storage.getMarketPilotOverview();
assert.equal(overviewAfterFill.auditLogs[0].action, "paper_filled_ticket");
assert.equal(overviewAfterFill.auditLogs[1].action, "acknowledged_paper_fill_compliance");

const close = await storage.closePaperTrade("ticket-sgov-rebalance", {
  exitPrice: 101.25,
  exitReason: "Closed after the paper exit plan was met and risk stayed inside limits.",
  followedExitCriteria: true,
  lessonsLearned: ["Exit criteria should be written before fill", "Paper monitoring needs a post-trade review"],
});
assert.equal(close.ticket.status, "closed");
assert.ok(close.realizedPnl > 0);
assert.ok(close.returnPct > 0);
const overviewAfterClose = await storage.getMarketPilotOverview();
assert.equal(overviewAfterClose.auditLogs[0].action, "paper_closed_ticket");
assert.ok(overviewAfterClose.journalEntries.some((entry) =>
  entry.id === close.journalEntry.id && /Paper close/.test(entry.title),
));

const assessment = await storage.submitQuizResult({
  moduleId: "module-risk-sizing",
  category: "risk_management",
  score: 88,
  answers: { riskPerTrade: "0.5%" },
  reflection: "I sized the paper trade from planned risk first and avoided increasing exposure after a loss.",
});
assert.equal(assessment.passed, true);
assert.ok(assessment.updatedScore.score > assessment.previousScore);
const overviewAfterAssessment = await storage.getMarketPilotOverview();
assert.equal(overviewAfterAssessment.auditLogs[0].action, "recorded_passing_quiz_result");
assert.ok(overviewAfterAssessment.proficiencyScores.some((score) =>
  score.category === "risk_management" && score.score === assessment.updatedScore.score,
));

const journalReview = await storage.submitJournalReview({
  journalEntryId: "journal-rate-shock",
  reflection:
    "I followed my risk plan on the review, identified that the original allocation change was too large, and wrote a specific rule to prevent the same mistake next time.",
  followedPlan: true,
  respectedStop: true,
  positionSizingDiscipline: 86,
  emotionalState: "calm",
  lessonsLearned: ["Set maximum allocation change before acting", "Check event calendar before rebalancing"],
});
assert.ok(journalReview.review.qualityScore >= 80);
assert.ok(journalReview.updatedScore.score > journalReview.previousScore);
const overviewAfterJournalReview = await storage.getMarketPilotOverview();
assert.equal(overviewAfterJournalReview.auditLogs[0].action, "reviewed_journal_entry");
assert.ok(overviewAfterJournalReview.journalEntries.some((entry) =>
  entry.id === "journal-rate-shock" && entry.qualityScore === journalReview.review.qualityScore,
));
assert.ok(overviewAfterJournalReview.proficiencyScores.some((score) =>
  score.category === "trading_psychology" && score.score === journalReview.updatedScore.score,
));

const updatedRiskSettings = await storage.updateRiskSettings({
  maxRiskPerTradePct: 0.2,
  reduceSizeAbovePct: 0.1,
  maxDailyLossPct: 1,
});
assert.equal(updatedRiskSettings.maxRiskPerTradePct, 0.2);
assert.equal(updatedRiskSettings.reduceSizeAbovePct, 0.1);
const overviewAfterRiskSettings = await storage.getMarketPilotOverview();
assert.equal(overviewAfterRiskSettings.auditLogs[0].action, "updated_risk_settings");
assert.ok(overviewAfterRiskSettings.riskRules.some((rule) =>
  rule.id === "risk-per-trade" && /0\.10% reduce \/ 0\.20% reject/.test(rule.limit),
));
const settingsReducedTicket = await storage.createTradeTicket({
  asset: "SGOV",
  direction: "buy",
  quantity: 10,
  entryPrice: 100.4,
  stopLoss: 89.4,
  timeHorizon: "4 weeks",
  rationale:
    "Paper proposal should be reduced by configurable risk thresholds before any paper preview.",
  supportingEvidence: ["Paper-only workflow", "Defined stop"],
  alternativeChoices: ["Hold cash"],
  exitCriteria: "Exit when risk rule is breached.",
  invalidationCondition: "Reject if configurable risk threshold is exceeded.",
});
assert.equal(settingsReducedTicket.riskCheck.decision, "reduce_size");

await storage.submitJournalReview({
  journalEntryId: "journal-rate-shock",
  reflection:
    "I became frustrated, ignored the plan, moved the stop, and increased size after the paper position moved against me.",
  followedPlan: false,
  respectedStop: false,
  positionSizingDiscipline: 30,
  emotionalState: "revenge",
  lessonsLearned: ["Pause before submitting another ticket"],
});
const cooledOffTicket = await storage.createTradeTicket({
  asset: "SGOV",
  direction: "buy",
  quantity: 1,
  entryPrice: 100.4,
  stopLoss: 99.9,
  timeHorizon: "4 weeks",
  rationale:
    "Paper proposal after a weak journal review should be blocked by behavioral cooling-off rules.",
  supportingEvidence: ["Paper-only workflow", "Defined stop"],
  alternativeChoices: ["Hold cash"],
  exitCriteria: "Exit when risk rule is breached.",
  invalidationCondition: "Reject if behavioral risk is active.",
});
assert.equal(cooledOffTicket.riskCheck.decision, "cooling_off");
assert.match(cooledOffTicket.riskCheck.reasons.join(" "), /Behavioral risk pattern/);

if (previousUrl === undefined) {
  delete process.env.DATABASE_URL;
} else {
  process.env.DATABASE_URL = previousUrl;
}

if (previousMode === undefined) {
  delete process.env.MARKETPILOT_STORAGE;
} else {
  process.env.MARKETPILOT_STORAGE = previousMode;
}

console.log("storage smoke tests passed");
