import assert from "node:assert/strict";
import { InMemoryOrchestrationRepository } from "./v2/orchestration/repository";
import { InMemoryDemoResearchPilotRepository } from "./v2/pilot/repository";
import { InMemoryV2OperationsRepository } from "./v2/operations/repository";
import type { DemoResearchPilotRecord, DemoResearchPilotScorecard } from "./v2/pilot/contracts";
import type { V2DailyResearchReport } from "./v2/operations/contracts";

const now = new Date().toISOString();

const orchestration = new InMemoryOrchestrationRepository();
const cycle = orchestration.saveCycle({
  cycleId: "cycle-memory-compat",
  status: "requested",
  requestedBy: "unit-test",
  idempotencyKey: "cycle-memory-compat-key",
  correlationId: "corr-memory-compat",
  createdAt: now,
  updatedAt: now,
});
assert.equal(cycle.inserted, true);
assert.equal(orchestration.saveCycle({ ...cycle.cycle }).inserted, false);
assert.equal(orchestration.markProcessed("event-memory-compat"), true);
assert.equal(orchestration.markProcessed("event-memory-compat"), false);
orchestration.checkpoint({
  consumerId: "consumer-memory-compat",
  sourceEventId: "event-memory-compat",
  idempotencyKey: "checkpoint-memory-compat",
  checkpointedAt: now,
  attempt: 1,
});
assert.equal(orchestration.checkpointFor("consumer-memory-compat")?.sourceEventId, "event-memory-compat");
assert.equal(orchestration.acquireLease("worker-memory-compat", Date.now(), 30_000, 1)?.workerId, "worker-memory-compat");

const pilotRecord = demoPilotRecord();
const pilotRepository = new InMemoryDemoResearchPilotRepository([pilotRecord]);
assert.equal(pilotRepository.get(pilotRecord.pilotId)?.state, "running");
pilotRepository.save({ ...pilotRecord, state: "paused", updatedAt: now });
assert.equal(pilotRepository.snapshot()[0]?.state, "paused");

const operationsRepository = new InMemoryV2OperationsRepository();
const reportRecord = {
  report: dailyReport(),
  status: "created" as const,
  correlationId: "corr-memory-compat",
  causationId: null,
  createdAt: now,
  updatedAt: now,
};
assert.equal(operationsRepository.saveReport(reportRecord).inserted, true);
assert.equal(operationsRepository.saveReport(reportRecord).inserted, false);
assert.equal(operationsRepository.getReportByDate(reportRecord.report.reportDate)?.report.reportId, reportRecord.report.reportId);
operationsRepository.saveDelivery({
  deliveryId: "delivery-memory-compat",
  reportId: reportRecord.report.reportId,
  destination: "telegram:redacted",
  deliveryAttempt: 1,
  idempotencyKey: "delivery-memory-compat-key",
  status: "failed",
  errorCode: "fixture",
  errorMessage: "redacted",
  correlationId: "corr-memory-compat",
  causationId: null,
  createdAt: now,
  updatedAt: now,
});
assert.equal(operationsRepository.deliveriesForReport(reportRecord.report.reportId)[0]?.status, "failed");

console.log("v2 durable repository compatibility tests passed");

function demoPilotRecord(): DemoResearchPilotRecord {
  return {
    pilotId: "pilot-memory-compat",
    schemaVersion: "fincoach.v2.demo-research-pilot.1",
    state: "running",
    config: {
      pilotId: "pilot-memory-compat",
      enabledInstruments: ["EUR_USD"],
      enabledTimeframes: ["M15"],
      researchBudget: 1,
      concurrencyBudget: 1,
      experimentBudget: 1,
      allowedDemoProviders: ["fixture"],
      signalPublicationPolicy: "disabled",
      externalEvaluationPolicy: "fixture_only",
      forwardTestingPolicy: "disabled",
      pilotStartTime: now,
      retentionDays: 1,
      healthThresholds: { maxDeadLetters: 0 },
      safeStopConditions: ["test"],
      externalPracticeTradesEnabled: false,
    },
    scorecard: emptyScorecard(),
    lineageEventIds: [],
    startedAt: now,
    stoppedAt: null,
    updatedAt: now,
  };
}

function emptyScorecard(): DemoResearchPilotScorecard {
  return {
    observationsGenerated: 0,
    hypothesesCreated: 0,
    hypothesesRejected: 0,
    experimentsQueued: 0,
    experimentsCompleted: 0,
    backtestsCompleted: 0,
    candidatesRejectedForOverfitting: 0,
    candidatesRejectedForLeakage: 0,
    courtroomVerdicts: 0,
    rankedCandidates: 0,
    lifecycleTransitions: 0,
    forwardTests: 0,
    signalsPublished: 0,
    externalEvaluations: 0,
    evaluatorDisagreements: 0,
    netR: 0,
    winRate: 0,
    expectancy: 0,
    drawdown: 0,
    costSensitivity: 0,
    calibration: 0,
    edgeDecay: 0,
    lessonsCreated: 0,
    strategyRevisionsProposed: 0,
    strategiesPaused: 0,
    strategiesDegraded: 0,
    strategiesRetired: 0,
    operationalFailures: 0,
    deadLetterEvents: 0,
    researchThroughput: 0,
    estimatedCostPerValidatedStrategy: 0,
  };
}

function dailyReport(): V2DailyResearchReport {
  return {
    reportId: "report-memory-compat",
    schemaVersion: "fincoach.v2.daily-research-report.1",
    reportDate: "2099-02-01",
    observations: 0,
    hypotheses: 0,
    experiments: 0,
    backtests: 0,
    courtVerdicts: 0,
    rankingChanges: 0,
    forwardTests: 0,
    signals: 0,
    externalEvaluations: 0,
    lessons: 0,
    lifecycleChanges: 0,
    operationalFailures: 0,
    deadLetterEvents: 0,
    dataGaps: 0,
    staleDataIncidents: 0,
    moduleHealth: { orchestration: "healthy" },
    liveExecutionBlocked: true,
    createdAt: now,
  };
}
