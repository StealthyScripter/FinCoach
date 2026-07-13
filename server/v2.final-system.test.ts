import assert from "node:assert/strict";
import { createDomainEvent } from "./v2/contracts";
import { DemoResearchPilotV2Service } from "./v2/pilot";

const correlationId = "00000000-0000-4000-8000-000000000026";
const eventTypes = [
  ["MarketDataImported", "market-data"],
  ["MarketContextCreated", "market-context"],
  ["ChartAnalysisCompleted", "chart-analysis"],
  ["FeaturesComputed", "fundamentals"],
  ["FundamentalContextAttached", "fundamentals"],
  ["ObservationCreated", "observations"],
  ["TraderAnalysisCompleted", "trader-emulators"],
  ["HypothesisCreated", "hypothesis"],
  ["RuleSetCompiled", "rules"],
  ["ExperimentScheduled", "experiments"],
  ["BacktestCompleted", "backtesting"],
  ["CourtroomVerdictRecorded", "courtroom"],
  ["MarketSimilarityComputed", "market-memory"],
  ["RankingDecisionCreated", "ranking"],
  ["LifecycleEligibilityChecked", "strategy-lifecycle"],
  ["ForwardTestCreated", "forward-testing"],
  ["SignalPublished", "signals"],
  ["ExternalEvaluationReceived", "external-evaluation"],
  ["ResearchJournalEntryRecorded", "journal"],
  ["LessonCreated", "learning"],
  ["MlEvidenceCreated", "ml-support"],
  ["StrategyRevisionProposed", "strategy-evolution"],
  ["StrategyPromoted", "strategy-lifecycle"],
  ["ResearchCycleCheckpointed", "orchestration"],
] as const;

const events = eventTypes.map(([eventType, sourceModule], index) => createDomainEvent({
  eventType,
  sourceModule,
  correlationId,
  causationId: index === 0 ? null : undefined,
  payload: { index, lineageEventIds: index === 0 ? [] : [`event-${index - 1}`] },
  metadata: { fixtureId: `event-${index}` },
}));

assert.equal(new Set(events.map(event => event.correlationId)).size, 1);
assert.equal(events.every((event, index) => index === 0 || Array.isArray(event.payload.lineageEventIds)), true);

const pilot = new DemoResearchPilotV2Service();
pilot.request({
  config: {
    pilotId: "system-pilot",
    enabledInstruments: ["EUR_USD"],
    enabledTimeframes: ["M15"],
    researchBudget: 100,
    concurrencyBudget: 1,
    experimentBudget: 5,
    allowedDemoProviders: ["fixture"],
    signalPublicationPolicy: "research_only",
    externalEvaluationPolicy: "fixture_only",
    forwardTestingPolicy: "demo_only",
    pilotStartTime: "2026-01-10T00:00:00.000Z",
    retentionDays: 30,
    healthThresholds: { maxDeadLetters: 1 },
    safeStopConditions: ["operator_stop"],
    externalPracticeTradesEnabled: false,
  },
  gates: {
    v2Enabled: true,
    researchEnabled: true,
    liveExecutionBlocked: true,
    killSwitchHealthy: true,
    postgresqlStateKnown: true,
    repositoriesHealthy: true,
    orchestrationHealthy: true,
    unresolvedCriticalDeadLetters: 0,
    brokerMode: "none",
    seededPromotedStrategies: 0,
    featureSchemaCompatible: true,
    migrationStateValid: true,
    providersHealthyOrExplicitlyDegraded: true,
  },
  correlationId,
});
pilot.updateScorecard("system-pilot", {
  observationsGenerated: 1,
  hypothesesCreated: 1,
  hypothesesRejected: 0,
  experimentsQueued: 1,
  experimentsCompleted: 1,
  backtestsCompleted: 1,
  candidatesRejectedForOverfitting: 0,
  candidatesRejectedForLeakage: 0,
  courtroomVerdicts: 1,
  rankedCandidates: 1,
  lifecycleTransitions: 1,
  forwardTests: 1,
  signalsPublished: 1,
  externalEvaluations: 1,
  evaluatorDisagreements: 1,
  netR: 0.1,
  winRate: 0.5,
  expectancy: 0.1,
  drawdown: 0.02,
  costSensitivity: 0.1,
  calibration: 0.8,
  edgeDecay: 0.05,
  lessonsCreated: 1,
  strategyRevisionsProposed: 1,
  strategiesPaused: 0,
  strategiesDegraded: 0,
  strategiesRetired: 0,
  operationalFailures: 0,
  deadLetterEvents: 1,
  researchThroughput: 3,
  estimatedCostPerValidatedStrategy: 10,
}, events.map(event => event.eventId), correlationId);
const report = pilot.report("system-pilot", correlationId).report!;
assert.equal(report.scorecard.deadLetterEvents, 1);
assert.equal(report.lineageEventIds.length, events.length);
assert.equal(report.safetyState.liveExecutionBlocked, true);
assert.equal(report.safetyState.externalPracticeTradesEnabled, false);
assert.equal(report.safetyState.historicalReplayNotForwardTesting, true);

console.log("v2 final system lineage tests passed");
