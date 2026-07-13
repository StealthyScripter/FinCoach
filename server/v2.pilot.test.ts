import assert from "node:assert/strict";
import { DemoResearchPilotV2EventTypes, DemoResearchPilotV2Service } from "./v2/pilot";

const correlationId = "00000000-0000-4000-8000-000000000026";
const config = {
  pilotId: "pilot-1",
  enabledInstruments: ["EUR_USD"],
  enabledTimeframes: ["M15"],
  researchBudget: 100,
  concurrencyBudget: 1,
  experimentBudget: 5,
  allowedDemoProviders: ["fixture"],
  signalPublicationPolicy: "research_only" as const,
  externalEvaluationPolicy: "fixture_only" as const,
  forwardTestingPolicy: "demo_only" as const,
  pilotStartTime: "2026-01-09T00:00:00.000Z",
  retentionDays: 30,
  healthThresholds: { maxDeadLetters: 0 },
  safeStopConditions: ["operator_stop"],
  externalPracticeTradesEnabled: false,
};
const gates = {
  v2Enabled: true,
  researchEnabled: true,
  liveExecutionBlocked: true,
  killSwitchHealthy: true,
  postgresqlStateKnown: true,
  repositoriesHealthy: true,
  orchestrationHealthy: true,
  unresolvedCriticalDeadLetters: 0,
  brokerMode: "none" as const,
  seededPromotedStrategies: 0,
  featureSchemaCompatible: true,
  migrationStateValid: true,
  providersHealthyOrExplicitlyDegraded: true,
};

const service = new DemoResearchPilotV2Service();
assert.equal(service.request({ config, gates: { ...gates, liveExecutionBlocked: false }, correlationId }).events[0].payload.reason, "live_execution_not_blocked");
assert.equal(service.request({ config, gates: { ...gates, seededPromotedStrategies: 1 }, correlationId }).events[0].payload.reason, "seeded_promoted_strategies");

const started = service.request({ config, gates, correlationId });
assert.equal(started.pilot?.state, "running");
assert.equal(started.events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotStarted);
assert.equal(started.pilot?.config.externalPracticeTradesEnabled, false);

const duplicate = service.request({ config, gates, correlationId });
assert.equal(duplicate.events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotStartupBlocked);
assert.equal(duplicate.events[0].payload.reason, "duplicate_pilot");

const score = service.updateScorecard("pilot-1", {
  observationsGenerated: 2,
  hypothesesCreated: 1,
  hypothesesRejected: 1,
  experimentsQueued: 1,
  experimentsCompleted: 1,
  backtestsCompleted: 1,
  candidatesRejectedForOverfitting: 1,
  candidatesRejectedForLeakage: 0,
  courtroomVerdicts: 1,
  rankedCandidates: 1,
  lifecycleTransitions: 1,
  forwardTests: 1,
  signalsPublished: 1,
  externalEvaluations: 1,
  evaluatorDisagreements: 1,
  netR: 0.4,
  winRate: 0.5,
  expectancy: 0.2,
  drawdown: 0.05,
  costSensitivity: 0.1,
  calibration: 0.8,
  edgeDecay: 0.1,
  lessonsCreated: 1,
  strategyRevisionsProposed: 1,
  strategiesPaused: 0,
  strategiesDegraded: 0,
  strategiesRetired: 0,
  operationalFailures: 0,
  deadLetterEvents: 0,
  researchThroughput: 3,
  estimatedCostPerValidatedStrategy: 12,
}, ["market-event", "context-event", "journal-event", "lesson-event", "ml-event", "evolution-event", "lifecycle-event"], correlationId);
assert.equal(score.events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotScorecardUpdated);
assert.equal(score.pilot?.scorecard.signalsPublished, 1);

assert.equal(service.pause("pilot-1", "operator pause", correlationId).events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotPaused);
assert.equal(service.resume("pilot-1", correlationId).events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotResumed);
const stopped = service.safeStop("pilot-1", "operator_stop", correlationId);
assert.equal(stopped.events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotStopped);
assert.equal(service.publishSignalAllowed("pilot-1"), false);

const report = service.report("pilot-1", correlationId);
assert.equal(report.report?.schemaVersion, "fincoach.v2.demo-research-pilot-report.1");
assert.equal(report.report?.liveExecutionBlocked, true);
assert.equal(report.report?.scorecard.signalsPublished, 1);
assert.deepEqual(report.report?.lineageEventIds, ["context-event", "evolution-event", "journal-event", "lesson-event", "lifecycle-event", "market-event", "ml-event"]);
assert.equal(report.events[0].eventType, DemoResearchPilotV2EventTypes.DemoResearchPilotReportCreated);

const restarted = new DemoResearchPilotV2Service(service.repositorySnapshot());
assert.equal(restarted.report("pilot-1", correlationId).report?.pilotId, "pilot-1");
assert.equal("placeOrder" in service || "submitOrder" in service || "enablePracticeTrade" in service, false);

console.log("v2 phase 26 demo research pilot tests passed");
