import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgOrchestrationRepository } from "./v2/orchestration/pgRepository";
import { PgDemoResearchPilotRepository } from "./v2/pilot/pgRepository";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import { V2OperationsService } from "./v2/operations/service";
import { V2PersistenceError } from "./v2/persistence/errors";
import type { DemoResearchPilotConfig, DemoResearchPilotScorecard } from "./v2/pilot/contracts";
import type { V2DailyResearchReport } from "./v2/operations/contracts";

if (!process.env.DATABASE_URL) {
  console.log("v2 operations projection PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `projection-${Date.now()}-${randomUUID().slice(0, 8)}`;
const correlationId = randomUUID();
const orchestration = new PgOrchestrationRepository(pool);
const pilot = new PgDemoResearchPilotRepository(pool);
const operations = new PgV2OperationsRepository(pool);
const service = new V2OperationsService({ orchestration, pilot, operations });

try {
  await seedProjectionEvidence();
  await testStatusProjection();
  await testListProjection();
  await testDailyReportProjection();
  await testUnavailableAndMalformedProjection();
  console.log("v2 operations projection PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function seedProjectionEvidence() {
  const now = new Date().toISOString();
  await orchestration.saveCycle({
    cycleId: `cycle-completed-${suffix}`,
    status: "completed",
    requestedBy: "projection-test",
    idempotencyKey: `cycle-completed-key-${suffix}`,
    correlationId,
    createdAt: now,
    updatedAt: now,
  });
  await orchestration.saveCycle({
    cycleId: `cycle-completed-older-${suffix}`,
    status: "completed",
    requestedBy: "projection-test",
    idempotencyKey: `cycle-completed-older-key-${suffix}`,
    correlationId,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await orchestration.saveCycle({
    cycleId: `cycle-failed-${suffix}`,
    status: "failed",
    requestedBy: "projection-test",
    idempotencyKey: `cycle-failed-key-${suffix}`,
    correlationId,
    createdAt: now,
    updatedAt: now,
  });
  await orchestration.saveRetry({
    sourceEventId: `retry-pending-${suffix}`,
    consumerId: `consumer-${suffix}`,
    idempotencyKey: `retry-pending-key-${suffix}`,
    attempt: 1,
    maxAttempts: 3,
    exhausted: false,
    nextRetryAt: now,
    lastErrorCode: "retryable_dependency_failure",
    correlationId,
    causationId: null,
  });
  await orchestration.saveRetry({
    sourceEventId: `retry-exhausted-${suffix}`,
    consumerId: `consumer-${suffix}`,
    idempotencyKey: `retry-exhausted-key-${suffix}`,
    attempt: 3,
    maxAttempts: 3,
    exhausted: true,
    nextRetryAt: null,
    lastErrorCode: "unknown_failure",
    correlationId,
    causationId: null,
  });
  await orchestration.acquireLease({ leaseName: `active-lease-${suffix}`, workerId: `worker-${suffix}`, now: new Date(), ttlMs: 60_000, correlationId });
  await orchestration.acquireLease({ leaseName: `stale-lease-${suffix}`, workerId: `stale-worker-${suffix}`, now: new Date(Date.now() - 120_000), ttlMs: 1, correlationId });
  await orchestration.addDeadLetter({
    deadLetterId: `dead-${suffix}`,
    sourceEventId: `dead-event-${suffix}`,
    reason: "poison_event",
    retryable: false,
    createdAt: now,
    payload: { source: "projection-test" },
    correlationId,
  });

  const config = pilotConfig(`pilot-${suffix}`);
  await pilot.saveInitial({
    pilotId: config.pilotId,
    schemaVersion: "fincoach.v2.demo-research-pilot.1",
    state: "running",
    config,
    scorecard: { ...emptyScorecard(), observationsGenerated: 7 },
    lineageEventIds: [`event-${suffix}`],
    startedAt: config.pilotStartTime,
    stoppedAt: null,
    updatedAt: now,
  }, { correlationId });

  const report = dailyReport(`report-${suffix}`, `2099-03-${String(Date.now()).slice(-2)}`);
  await operations.saveReport({ report, status: "created", correlationId, causationId: null, createdAt: report.createdAt, updatedAt: report.createdAt });
  await operations.saveDelivery({
    deliveryId: `delivery-${suffix}`,
    reportId: report.reportId,
    destination: "telegram:redacted-test",
    deliveryAttempt: 1,
    idempotencyKey: `delivery-key-${suffix}`,
    status: "failed",
    errorCode: "fixture_failure",
    errorMessage: "redacted failure",
    correlationId,
    causationId: null,
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  });
}

async function testStatusProjection() {
  const status = await service.statusAsync({ correlationId });
  assert.equal(status.body.schemaVersion, "fincoach.v2.operations-status.1");
  assert.equal(status.body.postgresqlHealth, "healthy");
  assert.equal((status.body.latestSuccessfulCycle as { cycleId: string }).cycleId, `cycle-completed-${suffix}`);
  assert.equal((status.body.latestFailedCycle as { cycleId: string }).cycleId, `cycle-failed-${suffix}`);
  assert.ok(Number(status.body.pendingRetries) >= 1);
  assert.ok(Number(status.body.exhaustedRetries) >= 1);
  assert.ok(Number(status.body.activeWorkerLeases) >= 1);
  assert.ok(Number(status.body.staleWorkerLeases) >= 1);
  assert.ok(Number(status.body.deadLetterCount) >= 1);
  assert.equal(status.body.pilotState, "running");
  assert.equal((status.body.latestScorecard as { observationsGenerated: number }).observationsGenerated, 7);
  assert.equal((status.body.latestDailyReport as { reportId: string }).reportId, `report-${suffix}`);
  assert.equal(status.body.liveExecutionBlocked, true);
}

async function testListProjection() {
  const list = await service.listAsync("orchestration", { limit: 1, offset: 0, status: "completed", correlationId });
  assert.equal(list.body.availability, "available");
  assert.equal(list.body.items.length, 1);
  assert.equal((list.body.items[0] as { cycleId: string }).cycleId, `cycle-completed-${suffix}`);
  assert.equal((list.body.items[0] as { sourceModule: string }).sourceModule, "orchestration");
  const secondPage = await service.listAsync("orchestration", { limit: 1, offset: 1, status: "completed", correlationId });
  assert.equal((secondPage.body.items[0] as { cycleId: string }).cycleId, `cycle-completed-older-${suffix}`);
  assert.ok((secondPage.body.pagination as { total: number }).total >= 2);
  const lessons = await service.listAsync("lessons", { limit: 5, offset: 0, correlationId });
  assert.equal(lessons.body.availability, "not_configured");
  assert.deepEqual(lessons.body.items, []);
}

async function testDailyReportProjection() {
  const created = await service.dailyReportAsync({ reportDate: `2099-04-${String(Date.now()).slice(-2)}`, correlationId });
  const duplicate = await service.dailyReportAsync({ reportDate: created.body.report.reportDate, correlationId });
  assert.equal(created.body.status, "created");
  assert.equal(duplicate.body.status, "existing");
  assert.equal(duplicate.body.report.reportId, created.body.report.reportId);
  await service.recordDailyReportDeliveryAsync(created.body.report.reportId, {
    destination: "telegram:contains-secret-like-chat-id",
    deliveryAttempt: 1,
    sent: false,
    error: "telegram outage",
    correlationId,
  });
  const deliveries = await operations.deliveriesForReport(created.body.report.reportId);
  assert.equal(deliveries[0]?.status, "failed");
  assert.notEqual(deliveries[0]?.destination, "telegram:contains-secret-like-chat-id");
}

async function testUnavailableAndMalformedProjection() {
  const unavailable = new V2OperationsService({
    operations: {
      latestReport: async () => {
        throw new V2PersistenceError("database_unavailable", "fixture unavailable");
      },
    } as never,
  });
  const unavailableStatus = await unavailable.statusAsync({ correlationId });
  assert.equal(unavailableStatus.body.postgresqlHealth, "temporarily_unavailable");
  assert.equal((unavailableStatus.body.moduleAvailability as Record<string, string>).operations, "temporarily_unavailable");

  const malformedReportId = `report-malformed-projection-${suffix}`;
  await pool.query(
    `INSERT INTO v2_operations_daily_reports
      (report_id, schema_version, report_date, idempotency_key, status, payload, correlation_id, created_at, updated_at)
     VALUES ($1, 'fincoach.v2.daily-research-report.1', $2, $2, 'created', $3, $4, $5, $5)`,
    [malformedReportId, `malformed-projection-${suffix}`, JSON.stringify({ schemaVersion: "fincoach.v2.daily-research-report.1", reportId: "wrong", reportDate: "wrong" }), correlationId, new Date().toISOString()],
  );
  const malformed = await service.statusAsync({ correlationId });
  assert.equal((malformed.body.moduleAvailability as Record<string, string>).operations, "degraded");
}

async function cleanup() {
  const pattern = `%${suffix}%`;
  await pool.query("DELETE FROM v2_operations_daily_report_deliveries WHERE delivery_id LIKE $1 OR report_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_operations_daily_reports WHERE report_id LIKE $1 OR report_date LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_scorecards WHERE pilot_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_lifecycle_transitions WHERE pilot_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_pilot_lifecycle WHERE pilot_id LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_dead_letters WHERE dead_letter_id LIKE $1 OR source_event_id LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_worker_leases WHERE lease_name LIKE $1 OR worker_id LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_retries WHERE retry_id LIKE $1 OR source_event_id LIKE $1 OR consumer_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_cycles WHERE cycle_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
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

function dailyReport(reportId: string, reportDate: string): V2DailyResearchReport {
  return {
    reportId,
    schemaVersion: "fincoach.v2.daily-research-report.1",
    reportDate,
    observations: 1,
    hypotheses: 1,
    experiments: 1,
    backtests: 1,
    courtVerdicts: 1,
    rankingChanges: 1,
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
    createdAt: new Date().toISOString(),
  };
}
