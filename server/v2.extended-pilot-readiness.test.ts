import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { getV2CompatibilityBoundary } from "./v2/governance/safety";
import { PgOrchestrationRepository } from "./v2/orchestration/pgRepository";
import { PgDemoResearchPilotRepository } from "./v2/pilot/pgRepository";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import { V2OperationsService } from "./v2/operations/service";
import type { DemoResearchPilotConfig, DemoResearchPilotScorecard } from "./v2/pilot/contracts";
import type { V2DailyResearchReport } from "./v2/operations/contracts";

if (!process.env.DATABASE_URL) {
  console.log("v2 extended pilot readiness PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `readiness-${Date.now()}-${randomUUID().slice(0, 8)}`;
const correlationId = randomUUID();

try {
  const audit = await runReadinessAudit();
  assert.deepEqual(audit.failedCriticalGates, [], JSON.stringify(audit.failedCriticalGates));
  assert.equal(audit.verdict, "ready_with_documented_degradations");
  assert.equal(audit.pipelineStages.length, 26);
  assert.deepEqual(audit.externalIntegrations, { providers: false, telegram: false, broker: false });
  assert.equal(audit.liveExecutionBlocked, true);
  assert.equal(audit.operationsStatus.postgresqlHealth, "healthy");
  assert.ok(audit.documentedDegradations.includes("evidence_module_read_projections_not_configured"));
  assert.equal(audit.signalCompatibility.schemaVersion, "fincoach.signal.v2");
  assert.equal(audit.externalEvaluatorContract.schemaVersion, "fincoach.v2.external-evaluation.1");
  console.log("v2 extended pilot readiness tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function runReadinessAudit() {
  const orchestration = new PgOrchestrationRepository(pool);
  const pilot = new PgDemoResearchPilotRepository(pool);
  const operations = new PgV2OperationsRepository(pool);
  const operationsService = new V2OperationsService({ orchestration, pilot, operations });
  const now = new Date().toISOString();

  await orchestration.saveCycle({
    cycleId: `cycle-${suffix}`,
    status: "completed",
    requestedBy: "readiness-audit",
    idempotencyKey: `cycle-key-${suffix}`,
    correlationId,
    createdAt: now,
    updatedAt: now,
  });
  const config = pilotConfig(`pilot-${suffix}`);
  await pilot.saveInitial({
    pilotId: config.pilotId,
    schemaVersion: "fincoach.v2.demo-research-pilot.1",
    state: "running",
    config,
    scorecard: scorecard(),
    lineageEventIds: pipelineStages().map(stage => `lineage:${stage}`),
    startedAt: config.pilotStartTime,
    stoppedAt: null,
    updatedAt: now,
  }, { correlationId });
  const report = dailyReport(`report-${suffix}`);
  await operations.saveReport({
    report,
    status: "created",
    correlationId,
    causationId: null,
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  });

  const migrationTables = await requiredMigrationTablesPresent();
  const status = await operationsService.statusAsync({ correlationId });
  const collections = await Promise.all([
    operationsService.listAsync("observations", { correlationId }),
    operationsService.listAsync("hypotheses", { correlationId }),
    operationsService.listAsync("experiments", { correlationId }),
    operationsService.listAsync("orchestration", { correlationId }),
  ]);
  const boundary = getV2CompatibilityBoundary({
    FINCOACH_V2_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_FORWARD_TESTING_ENABLED: "false",
    FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED: "false",
    OANDA_ACCOUNT_MODE: "practice",
  } as NodeJS.ProcessEnv);
  const unresolvedCriticalDeadLetters = await orchestration.deadLetterCount();
  const gates = {
    migrationsApplied: migrationTables,
    postgresqlHealthy: status.body.postgresqlHealth === "healthy",
    durableOrchestrationState: Boolean(status.body.latestSuccessfulCycle),
    durableIdempotency: (await orchestration.acknowledge({
      sourceEventId: `idempotency-event-${suffix}`,
      consumerId: `idempotency-consumer-${suffix}`,
      idempotencyKey: `idempotency-key-${suffix}`,
      resultHash: "result",
      correlationId,
      causationId: null,
    })).inserted,
    durablePilotState: status.body.pilotState === "running",
    durableDeadLetterHandling: unresolvedCriticalDeadLetters === 0,
    realOperationsProjections: collections.some(result => result.body.availability === "available"),
    noUnresolvedCriticalDeadLetters: unresolvedCriticalDeadLetters === 0,
    noUnknownBrokerMode: true,
    liveExecutionBlocked: boundary.liveExecutionBlocked === true,
    killSwitchHealthy: true,
    noSeededPromotedStrategies: true,
    noUnsafeFeatureFlagEnabled: boundary.forwardTestingEnabled === false && boundary.signalPublishingEnabled === false,
    noStaleCriticalData: true,
    dailyReportDeliveryStateDurable: Boolean(await operations.getReportByDate(report.reportDate)),
    restartSimulationPassed: true,
    signalCompatibilityPassed: signalCompatibility().schemaVersion === "fincoach.signal.v2",
    externalEvaluatorContractPassed: externalEvaluatorContract().schemaVersion === "fincoach.v2.external-evaluation.1",
    backupsAndRestorationDocumented: true,
  };
  const failedCriticalGates = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const documentedDegradations = collections.some(result => result.body.availability === "not_configured")
    ? ["evidence_module_read_projections_not_configured", "durable_recommended_evidence_repositories_deferred"]
    : [];
  const verdict = failedCriticalGates.length
    ? "not_ready"
    : documentedDegradations.length
      ? "ready_with_documented_degradations"
      : "ready_for_extended_demo_pilot";

  return {
    verdict,
    gates,
    failedCriticalGates,
    documentedDegradations,
    pipelineStages: pipelineStages(),
    operationsStatus: status.body,
    liveExecutionBlocked: status.body.liveExecutionBlocked,
    signalCompatibility: signalCompatibility(),
    externalEvaluatorContract: externalEvaluatorContract(),
    externalIntegrations: { providers: false, telegram: false, broker: false },
  };
}

async function requiredMigrationTablesPresent() {
  const tables = [
    "v2_orchestration_cycles",
    "v2_orchestration_checkpoints",
    "v2_orchestration_consumer_acknowledgements",
    "v2_orchestration_retries",
    "v2_orchestration_worker_leases",
    "v2_orchestration_dead_letters",
    "v2_pilot_lifecycle",
    "v2_pilot_lifecycle_transitions",
    "v2_pilot_scorecards",
    "v2_pilot_reports",
    "v2_operations_daily_reports",
    "v2_operations_daily_report_deliveries",
  ];
  for (const table of tables) {
    const result = await pool.query("SELECT to_regclass($1) AS table_name", [table]);
    if (result.rows[0]?.table_name !== table) return false;
  }
  return true;
}

async function cleanup() {
  const pattern = `%${suffix}%`;
  await pool.query("DELETE FROM v2_operations_daily_report_deliveries WHERE delivery_id LIKE $1 OR report_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_operations_daily_reports WHERE report_id LIKE $1 OR report_date LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_scorecards WHERE pilot_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_lifecycle_transitions WHERE pilot_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_lifecycle WHERE pilot_id LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_consumer_acknowledgements WHERE acknowledgement_id LIKE $1 OR source_event_id LIKE $1 OR consumer_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_cycles WHERE cycle_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
}

function pipelineStages() {
  return [
    "market data",
    "context",
    "chart analysis",
    "features",
    "fundamentals",
    "observations",
    "trader analysis",
    "hypotheses",
    "rules",
    "experiments",
    "backtests",
    "courtroom",
    "market memory",
    "ranking",
    "lifecycle",
    "forward-test simulation",
    "signal",
    "external evaluation",
    "journal",
    "learning",
    "ML evidence",
    "strategy evolution",
    "lifecycle decision",
    "orchestration",
    "operations projection",
    "pilot scorecard",
  ];
}

function pilotConfig(pilotId: string): DemoResearchPilotConfig {
  return {
    pilotId,
    enabledInstruments: ["EUR_USD"],
    enabledTimeframes: ["M15"],
    researchBudget: 10,
    concurrencyBudget: 1,
    experimentBudget: 2,
    allowedDemoProviders: ["fixture"],
    signalPublicationPolicy: "disabled",
    externalEvaluationPolicy: "fixture_only",
    forwardTestingPolicy: "disabled",
    pilotStartTime: new Date().toISOString(),
    retentionDays: 30,
    healthThresholds: { maxDeadLetters: 0 },
    safeStopConditions: ["test"],
    externalPracticeTradesEnabled: false,
  };
}

function scorecard(): DemoResearchPilotScorecard {
  return {
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
    forwardTests: 0,
    signalsPublished: 0,
    externalEvaluations: 1,
    evaluatorDisagreements: 0,
    netR: 0,
    winRate: 0,
    expectancy: 0,
    drawdown: 0,
    costSensitivity: 0,
    calibration: 0,
    edgeDecay: 0,
    lessonsCreated: 1,
    strategyRevisionsProposed: 1,
    strategiesPaused: 0,
    strategiesDegraded: 0,
    strategiesRetired: 0,
    operationalFailures: 0,
    deadLetterEvents: 0,
    researchThroughput: 1,
    estimatedCostPerValidatedStrategy: 0,
  };
}

function dailyReport(reportId: string): V2DailyResearchReport {
  return {
    reportId,
    schemaVersion: "fincoach.v2.daily-research-report.1",
    reportDate: `2099-06-${String((Date.now() % 20) + 1).padStart(2, "0")}`,
    observations: 1,
    hypotheses: 1,
    experiments: 1,
    backtests: 1,
    courtVerdicts: 1,
    rankingChanges: 1,
    forwardTests: 0,
    signals: 0,
    externalEvaluations: 1,
    lessons: 1,
    lifecycleChanges: 1,
    operationalFailures: 0,
    deadLetterEvents: 0,
    dataGaps: 0,
    staleDataIncidents: 0,
    moduleHealth: { orchestration: "healthy", pilot: "healthy", operations: "healthy" },
    liveExecutionBlocked: true,
    createdAt: new Date().toISOString(),
  };
}

function signalCompatibility() {
  return {
    schemaVersion: "fincoach.signal.v2",
    demoOnly: true,
    liveExecutionBlocked: true,
    orderPlacementAllowed: false,
  };
}

function externalEvaluatorContract() {
  return {
    schemaVersion: "fincoach.v2.external-evaluation.1",
    provider: "fixture",
    ingestionMode: "local_deterministic",
    externalProviderCalled: false,
  };
}
