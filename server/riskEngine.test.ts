import assert from "node:assert/strict";
import { evaluateTradeTicketRisk } from "./riskEngine";
import type { ProficiencyScore, TradeTicketProposal } from "@shared/schema";

const checkedAt = "2026-06-15T00:00:00.000Z";
const scores: ProficiencyScore[] = [
  {
    id: "options-low",
    category: "options",
    label: "Options",
    score: 32,
    unlocks: [],
    evidence: [],
    updatedAt: checkedAt,
  },
];

const baseProposal: TradeTicketProposal = {
  asset: "VTI",
  direction: "buy",
  quantity: 5,
  entryPrice: 260,
  stopLoss: 247,
  timeHorizon: "4 weeks",
  rationale: "Paper broad-market rebalance with limited defined risk.",
  supportingEvidence: ["Paper workflow", "No leverage"],
  alternativeChoices: ["Hold cash"],
  exitCriteria: "Exit on risk breach.",
  invalidationCondition: "Risk check fails.",
};

const approved = evaluateTradeTicketRisk({
  proposal: baseProposal,
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  checkedAt,
});

assert.equal(approved.riskCheck.decision, "approve");
assert.equal(approved.status, "proposed");
assert.equal(approved.riskAmount, 65);

const oversized = evaluateTradeTicketRisk({
  proposal: {
    ...baseProposal,
    quantity: 50,
    entryPrice: 550,
    stopLoss: 520,
  },
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  checkedAt,
});

assert.equal(oversized.riskCheck.decision, "reject");
assert.equal(oversized.status, "risk_rejected");
assert.equal(oversized.riskAmount, 1500);

const configurableReduced = evaluateTradeTicketRisk({
  proposal: {
    ...baseProposal,
    quantity: 10,
  },
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  checkedAt,
  riskSettings: {
    id: "risk-settings-test",
    maxRiskPerTradePct: 0.2,
    reduceSizeAbovePct: 0.1,
    maxDailyLossPct: 1,
    maxWeeklyLossPct: 3,
    maxSinglePositionPct: 12,
    maxOptionsPremiumPct: 0.5,
    noTradeBeforeHighImpactEventHours: 24,
    updatedAt: checkedAt,
  },
});

assert.equal(configurableReduced.riskCheck.decision, "reduce_size");
assert.match(configurableReduced.riskCheck.reasons.join(" "), /reduce above 0.10%, reject above 0.20%/);

const lockedOptions = evaluateTradeTicketRisk({
  proposal: {
    ...baseProposal,
    asset: "QQQ 30D Call",
    quantity: 1,
    entryPrice: 5.2,
    stopLoss: undefined,
  },
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  checkedAt,
});

assert.equal(lockedOptions.riskCheck.decision, "require_quiz");
assert.equal(lockedOptions.status, "risk_rejected");
assert.match(lockedOptions.riskCheck.reasons.join(" "), /Options proficiency/);

const eventBlocked = evaluateTradeTicketRisk({
  proposal: baseProposal,
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  eventRisks: [
    {
      id: "event-cpi",
      title: "US CPI inflation release",
      category: "macro",
      impact: "high",
      startsAt: "2026-06-16T12:00:00.000Z",
      relatedAssets: ["VTI"],
      riskNote: "Inflation surprises can move yields and equities.",
    },
  ],
  checkedAt,
});

assert.equal(eventBlocked.riskCheck.decision, "cooling_off");
assert.equal(eventBlocked.status, "risk_rejected");
assert.match(eventBlocked.riskCheck.reasons.join(" "), /Major event risk/);

const behaviorBlocked = evaluateTradeTicketRisk({
  proposal: baseProposal,
  portfolioValue: 100000,
  liveTradingEnabled: false,
  proficiencyScores: scores,
  behavioralRisk: {
    tradingPsychologyScore: 44,
    recentJournalQuality: 42,
    mistakePatterns: ["revenge emotional state", "Ignored or moved stop/exit logic"],
  },
  checkedAt,
});

assert.equal(behaviorBlocked.riskCheck.decision, "cooling_off");
assert.equal(behaviorBlocked.status, "risk_rejected");
assert.match(behaviorBlocked.riskCheck.reasons.join(" "), /Behavioral risk pattern/);
assert.match(behaviorBlocked.riskCheck.requiredActions.join(" "), /cooling-off journal review/);

console.log("riskEngine smoke tests passed");
