import assert from "node:assert/strict";
import { evaluatePromotionReadiness, StrategyResearchSchedulerService } from "./strategyResearchSchedulerService";

const safeEnv = {
  MARKETPILOT_RUN_MODE: "demo_observation",
  MARKETPILOT_DEMO_ONLY: "true",
  OANDA_ENV: "practice",
} as NodeJS.ProcessEnv;

const scheduler = new StrategyResearchSchedulerService(safeEnv);
const initial = scheduler.snapshot();
assert.deepEqual(initial.allowedStrategies, [], "empty strategy list should be valid");
assert.equal(initial.health.liveExecutionEnabled, false);

const blocked = await new StrategyResearchSchedulerService({ MARKETPILOT_RUN_MODE: "live" } as NodeJS.ProcessEnv)
  .runOnce({ runState: "running", now: new Date("2026-01-01T08:00:00.000Z") });
assert.equal(blocked.health.status, "blocked");
assert.equal(blocked.counts.experimentsCreated, 0);
assert.match(blocked.lastSkipReason ?? "", /demo_observation/);

const paused = await scheduler.runOnce({ runState: "paused", now: new Date("2026-01-01T08:00:00.000Z") });
assert.equal(paused.health.status, "paused");
assert.match(paused.lastSkipReason ?? "", /paused/);

const completed = await scheduler.runOnce({ runState: "completed", now: new Date("2026-01-01T08:05:00.000Z") });
assert.equal(completed.health.status, "idle");
assert.equal(completed.lastSkipReason, "demo_run_completed");

const result = await scheduler.runOnce({ runState: "running", now: new Date("2026-01-01T08:30:00.000Z") });
assert.equal(result.health.status, "healthy");
assert.deepEqual(result.allowedStrategies, [], "scheduler must not seed active strategies");
assert.ok(result.counts.patternsDetected >= 5, "discovered patterns should be recorded");
assert.ok(result.counts.hypothesesCreated >= 1, "patterns should create hypotheses");
assert.ok(result.counts.ruleSetsCreated >= 1, "hypotheses should create objective rules");
assert.ok(result.counts.experimentsCreated >= 1, "rule sets should create experiments");
assert.ok(result.counts.backtestsRun >= 1, "experiments should run backtests");
assert.ok(result.counts.validationsRun >= 1, "backtests should be validated");
assert.equal(result.counts.forwardTestsStarted, 0, "unstable candidates should not start demo forward tests");
assert.equal(result.counts.journalEntriesCreated, 0, "non-promoted candidates should not create forward-test journals");
assert.equal(result.counts.promoted, 0, "deeper data alone must not promote strategies");
assert.equal(result.counts.promotedWithoutFullEvidenceCount, 0);
assert.equal(result.promotedCandidates.length, 0);
assert.equal(result.historicalDataCoverage.length, 5);
assert.ok(result.historicalDataCoverage.every((coverage) => coverage.candlesAvailable >= 420));
assert.equal(result.sampleDepthReports.length, 5);
assert.ok(result.sampleDepthReports.every((report) => report.candlesAvailable >= 420));

const xauQueued = result.experimentQueue.find((candidate) => candidate.symbol === "XAU/USD");
assert.ok(xauQueued, "current XAU/USD candidate should be evaluated");
assert.equal(xauQueued.status, "watch");
assert.equal(xauQueued.validationVerdict, "watch");

for (const rejected of result.rejectedCandidates) {
  assert.ok(rejected.reason.length > 10, "rejected candidates should include clear rejection reasons");
  assert.ok(rejected.quality.rejectionReasons.length >= 1, "quality rejection reasons should be preserved");
}

assert.ok(result.latestDiscoveredPatterns.some((pattern) => pattern.patternType === "breakout" || pattern.patternType === "session_breakout"));
assert.ok(result.latestHypotheses.some((hypothesis) => hypothesis.status === "created" || hypothesis.status === "needs_more_data"));
assert.ok(result.experimentQueue.some((item) => item.status === "watch"));
assert.equal(result.health.liveExecutionEnabled, false);

const unsafeEnv = {
  MARKETPILOT_RUN_MODE: "demo_observation",
  MARKETPILOT_DEMO_ONLY: "false",
  OANDA_ENV: "live",
} as NodeJS.ProcessEnv;
const unsafe = await new StrategyResearchSchedulerService(unsafeEnv).runOnce({ runState: "running", now: new Date("2026-01-01T08:30:00.000Z") });
assert.equal(unsafe.counts.forwardTestsStarted, 0, "live/unsafe execution must remain impossible");
assert.ok(unsafe.rejectedCandidates.length === 0 || unsafe.rejectedCandidates.some((candidate) => /Live execution|demo-only|not allowed/i.test(candidate.reason)));

const goodRuleSet = {
  ruleSetId: "xau-quality-rule",
  version: 1,
  entryCondition: [{ field: "confirmedBreakoutDistanceAtr", operator: ">", value: 0.2 }],
  exitCondition: [{ field: "barsInTrade", operator: ">=", value: 12 }],
  stopLossRule: [{ field: "stopDistanceAtr", operator: ">=", value: 0.8 }],
  takeProfitRule: [{ field: "targetR", operator: ">=", value: 1.5 }],
  sourceHypothesisRefs: [{ eventId: "hyp", eventType: "HypothesisCreated", module: "hypothesis", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:00:00.000Z" }],
};
const journal = {
  entryReason: "breakout plus pullback supported hypothesis xau-hypothesis",
  hypothesisId: "xau-hypothesis",
  ruleVersion: 1,
  stopLoss: 2348,
  takeProfit: 2353,
  expectedOutcome: "positive expectancy paper/demo forward-test setup",
  actualOutcome: "open",
  lessonLearned: "Forward test opened in paper/demo tracking only.",
  beforeEntrySnapshotRefs: [{ eventId: "snapshot", eventType: "MarketSnapshotCreated", module: "market-data", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:00:00.000Z" }],
  sourceEventRefs: [
    { eventId: "hyp", eventType: "HypothesisCreated", module: "hypothesis", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:00:00.000Z" },
    { eventId: "rule", eventType: "RuleSetCreated", module: "rule-builder", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:01:00.000Z" },
  ],
};
const lineage = [
  journal.beforeEntrySnapshotRefs[0],
  ...journal.sourceEventRefs,
  { eventId: "backtest", eventType: "BacktestCompleted", module: "backtesting", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:02:00.000Z" },
  { eventId: "validation", eventType: "ExperimentValidated", module: "validation", schemaVersion: "strategy-machine.v1", occurredAt: "2026-01-01T08:03:00.000Z" },
];
const fullEvidence = evaluatePromotionReadiness({
  validationVerdict: "candidate",
  validationResult: { actualSampleSize: 40, evidenceScore: 0.72, overfittingWarning: false },
  backtestResult: { expectancy: 0.12, profitFactor: 1.7, maxDrawdown: 0.8 },
  detectedPatternCount: 2,
  ruleSet: goodRuleSet,
  invalidationEvidenceCount: 2,
  demoOnlyApproved: true,
  marketSnapshotRefCount: 1,
  journal,
  eventLineageRefs: lineage,
});
assert.equal(fullEvidence.fullEvidence, true, "XAU/USD promoted candidate template should have complete evidence");
assert.equal(fullEvidence.stopLossTakeProfitPresent, true);
assert.equal(fullEvidence.marketSnapshotBeforeEntry, true);
assert.equal(fullEvidence.journalRequiredFieldsPresent, true);

const singlePattern = evaluatePromotionReadiness({ ...qualityInput(), detectedPatternCount: 1 });
assert.equal(singlePattern.fullEvidence, false);
assert.match(singlePattern.rejectionReasons.join(" "), /two detected patterns/);

const insufficientSample = evaluatePromotionReadiness({
  ...qualityInput(),
  validationResult: { actualSampleSize: 12, evidenceScore: 0.8, overfittingWarning: false },
});
assert.equal(insufficientSample.fullEvidence, false);
assert.match(insufficientSample.rejectionReasons.join(" "), /Minimum sample depth/);

const unstableBacktest = evaluatePromotionReadiness({
  ...qualityInput(),
  validationResult: { actualSampleSize: 40, evidenceScore: 0.72, overfittingWarning: true },
});
assert.equal(unstableBacktest.fullEvidence, false);
assert.match(unstableBacktest.rejectionReasons.join(" "), /overfitting|unstable/);

const missingDemoApproval = evaluatePromotionReadiness({ ...qualityInput(), demoOnlyApproved: false });
assert.equal(missingDemoApproval.fullEvidence, false);
assert.match(missingDemoApproval.rejectionReasons.join(" "), /Demo-only policy approval/);

console.log("strategy research scheduler tests passed");

function qualityInput() {
  return {
    validationVerdict: "candidate",
    validationResult: { actualSampleSize: 40, evidenceScore: 0.72, overfittingWarning: false },
    backtestResult: { expectancy: 0.12, profitFactor: 1.7, maxDrawdown: 0.8 },
    detectedPatternCount: 2,
    ruleSet: goodRuleSet,
    invalidationEvidenceCount: 2,
    demoOnlyApproved: true,
    marketSnapshotRefCount: 1,
    journal,
    eventLineageRefs: lineage,
  };
}
