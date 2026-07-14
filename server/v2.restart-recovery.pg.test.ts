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
  console.log("v2 restart recovery PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `restart-${Date.now()}-${randomUUID().slice(0, 8)}`;
const correlationId = randomUUID();

try {
  await testRestartRecovery();
  await testOutageAndMigrationFailures();
  console.log("v2 restart recovery PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function testRestartRecovery() {
  const beforeRestart = {
    orchestration: new PgOrchestrationRepository(pool),
    pilot: new PgDemoResearchPilotRepository(pool),
    operations: new PgV2OperationsRepository(pool),
  };
  const now = new Date().toISOString();

  await beforeRestart.orchestration.saveCycle({
    cycleId: `cycle-active-${suffix}`,
    status: "running",
    requestedBy: "restart-test",
    idempotencyKey: `cycle-active-key-${suffix}`,
    correlationId,
    createdAt: now,
    updatedAt: now,
  });
  await beforeRestart.orchestration.acknowledge({
    sourceEventId: `event-before-ack-${suffix}`,
    consumerId: `consumer-${suffix}`,
    idempotencyKey: `ack-key-${suffix}`,
    resultHash: "result-hash",
    correlationId,
    causationId: null,
    createdAt: now,
  });
  await beforeRestart.orchestration.checkpoint({
    consumerId: `checkpoint-consumer-${suffix}`,
    sourceEventId: `event-checkpoint-${suffix}`,
    idempotencyKey: `checkpoint-key-${suffix}`,
    checkpointedAt: now,
    attempt: 1,
    correlationId,
    causationId: null,
  });
  await beforeRestart.orchestration.saveRetry({
    sourceEventId: `retry-event-${suffix}`,
    consumerId: `retry-consumer-${suffix}`,
    idempotencyKey: `retry-key-${suffix}`,
    attempt: 2,
    maxAttempts: 3,
    exhausted: false,
    nextRetryAt: now,
    lastErrorCode: "retryable_dependency_failure",
    correlationId,
    causationId: null,
  });
  await beforeRestart.orchestration.addDeadLetter({
    deadLetterId: `dead-${suffix}`,
    sourceEventId: `dead-event-${suffix}`,
    reason: "poison_event",
    retryable: true,
    createdAt: now,
    payload: { source: "restart-test" },
    correlationId,
  });
  await beforeRestart.orchestration.acquireLease({
    leaseName: `expired-lease-${suffix}`,
    workerId: `old-worker-${suffix}`,
    now: new Date(Date.now() - 120_000),
    ttlMs: 1,
    correlationId,
  });

  const config = pilotConfig(`pilot-${suffix}`);
  await beforeRestart.pilot.saveInitial({
    pilotId: config.pilotId,
    schemaVersion: "fincoach.v2.demo-research-pilot.1",
    state: "running",
    config,
    scorecard: { ...scorecard(), operationalFailures: 1 },
    lineageEventIds: [`pilot-start-${suffix}`],
    startedAt: config.pilotStartTime,
    stoppedAt: null,
    updatedAt: now,
  }, { correlationId });
  const stopping = await beforeRestart.pilot.transition({
    pilotId: config.pilotId,
    expectedState: "running",
    toState: "stopping",
    idempotencyKey: `pilot-safe-stop-${suffix}`,
    correlationId,
    now,
  });
  assert.equal(stopping.status, "transitioned");

  const report = dailyReport(`report-${suffix}`, reportDate());
  await beforeRestart.operations.saveReport({
    report,
    status: "created",
    correlationId,
    causationId: null,
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  });
  await beforeRestart.operations.saveDelivery({
    deliveryId: `delivery-${suffix}`,
    reportId: report.reportId,
    destination: "telegram:redacted",
    deliveryAttempt: 1,
    idempotencyKey: `delivery-key-${suffix}`,
    status: "delivered",
    errorCode: null,
    errorMessage: null,
    correlationId,
    causationId: null,
    createdAt: now,
    updatedAt: now,
  });

  const afterRestart = {
    orchestration: new PgOrchestrationRepository(pool),
    pilot: new PgDemoResearchPilotRepository(pool),
    operations: new PgV2OperationsRepository(pool),
  };

  assert.equal((await afterRestart.orchestration.latestCycle("running"))?.cycleId, `cycle-active-${suffix}`);
  assert.equal((await afterRestart.orchestration.checkpointFor(`checkpoint-consumer-${suffix}`))?.sourceEventId, `event-checkpoint-${suffix}`);
  assert.equal((await afterRestart.orchestration.retryFor(`retry-event-${suffix}`, `retry-consumer-${suffix}`))?.attempt, 2);
  assert.equal((await afterRestart.orchestration.staleLeases(new Date())).some(lease => lease.leaseName === `expired-lease-${suffix}`), true);
  assert.equal((await afterRestart.orchestration.deadLetters()).some(dead => dead.deadLetterId === `dead-${suffix}`), true);
  assert.equal((await afterRestart.pilot.get(config.pilotId))?.state, "stopping");
  assert.equal((await afterRestart.operations.getReportByDate(report.reportDate))?.report.reportId, report.reportId);
  assert.equal((await afterRestart.operations.deliveriesForReport(report.reportId))[0]?.status, "delivered");

  const duplicateAck = await afterRestart.orchestration.acknowledge({
    sourceEventId: `event-before-ack-${suffix}`,
    consumerId: `consumer-${suffix}`,
    idempotencyKey: `ack-key-${suffix}`,
    resultHash: "result-hash",
    correlationId,
    causationId: null,
  });
  assert.equal(duplicateAck.conflict, "idempotent");

  const recoveredLease = await afterRestart.orchestration.acquireLease({
    leaseName: `expired-lease-${suffix}`,
    workerId: `new-worker-${suffix}`,
    now: new Date(),
    ttlMs: 60_000,
    correlationId,
  });
  assert.equal(recoveredLease?.workerId, `new-worker-${suffix}`);

  const replayed = await afterRestart.orchestration.recordDeadLetterReplay(`dead-${suffix}`);
  assert.equal(replayed.deadLetterId, `dead-${suffix}`);

  await assert.rejects(
    () => afterRestart.orchestration.acknowledgeAndCheckpoint({
      acknowledgement: {
        sourceEventId: `event-before-ack-${suffix}`,
        consumerId: `consumer-${suffix}`,
        idempotencyKey: `conflicting-ack-key-${suffix}`,
        resultHash: "different-result",
        correlationId,
        causationId: null,
      },
      checkpoint: {
        consumerId: `rolled-back-consumer-${suffix}`,
        sourceEventId: `rolled-back-event-${suffix}`,
        idempotencyKey: `rolled-back-checkpoint-${suffix}`,
        checkpointedAt: new Date().toISOString(),
        attempt: 1,
        correlationId,
        causationId: null,
      },
    }),
    (error) => error instanceof V2PersistenceError && error.code === "conflicting_duplicate",
  );
  assert.equal(await afterRestart.orchestration.checkpointFor(`rolled-back-consumer-${suffix}`), null);

  const projection = new V2OperationsService(afterRestart);
  const status = await projection.statusAsync({ correlationId });
  assert.equal(status.body.liveExecutionBlocked, true);
  assert.equal(Number(status.body.signals), 0);
  assert.equal(Number(status.body.forwardTests), 0);
  assert.equal(Number(status.body.lifecycleStates), 0);
  assert.equal(status.body.postgresqlHealth, "healthy");
}

async function testOutageAndMigrationFailures() {
  const outage = new PgOrchestrationRepository({
    query: async () => {
      const error = new Error("database unavailable") as Error & { code: string };
      error.code = "ECONNREFUSED";
      throw error;
    },
  });
  await assert.rejects(
    () => outage.checkpoint({
      consumerId: `outage-consumer-${suffix}`,
      sourceEventId: `outage-event-${suffix}`,
      idempotencyKey: `outage-key-${suffix}`,
      checkpointedAt: new Date().toISOString(),
      attempt: 1,
      correlationId,
      causationId: null,
    }),
    (error) => error instanceof V2PersistenceError && error.code === "database_unavailable",
  );
  await assert.rejects(
    () => outage.renewLease({ leaseName: `outage-lease-${suffix}`, workerId: "worker", fencingToken: 1, now: new Date(), ttlMs: 1000, correlationId }),
    (error) => error instanceof V2PersistenceError && error.code === "database_unavailable",
  );

  const migrationMismatch = new PgOrchestrationRepository({
    query: async () => {
      const error = new Error("relation does not exist") as Error & { code: string };
      error.code = "42P01";
      throw error;
    },
  });
  await assert.rejects(
    () => migrationMismatch.latestCycle(),
    (error) => error instanceof V2PersistenceError && error.code === "migration_mismatch",
  );

  const operations = new PgV2OperationsRepository(pool);
  const unsupportedReportId = `unsupported-report-${suffix}`;
  await pool.query(
    `INSERT INTO v2_operations_daily_reports
      (report_id, schema_version, report_date, idempotency_key, status, payload, correlation_id, created_at, updated_at)
     VALUES ($1, 'fincoach.v2.daily-research-report.999', $2, $2, 'created', $3, $4, $5, $5)`,
    [unsupportedReportId, `unsupported-${suffix}`, JSON.stringify({}), correlationId, new Date().toISOString()],
  );
  await assert.rejects(
    () => operations.getReportByDate(`unsupported-${suffix}`),
    (error) => error instanceof V2PersistenceError && error.code === "unsupported_schema_version",
  );

  const malformedDeadLetterId = `malformed-dead-${suffix}`;
  await pool.query(
    `INSERT INTO v2_orchestration_dead_letters
      (dead_letter_id, schema_version, source_event_id, reason, retryable, correlation_id, payload, created_at)
     VALUES ($1, 'fincoach.v2.orchestration.1', $2, 'poison_event', true, $3, $4, $5)`,
    [malformedDeadLetterId, `malformed-event-${suffix}`, correlationId, JSON.stringify("not-an-object"), new Date().toISOString()],
  );
  await assert.rejects(
    () => new PgOrchestrationRepository(pool).deadLetters(),
    (error) => error instanceof V2PersistenceError && error.code === "malformed_persisted_record",
  );

  const pilot = new PgDemoResearchPilotRepository({
    query: async () => {
      const error = new Error("database unavailable") as Error & { code: string };
      error.code = "ECONNREFUSED";
      throw error;
    },
  });
  await assert.rejects(
    () => pilot.saveInitial({
      pilotId: `outage-pilot-${suffix}`,
      schemaVersion: "fincoach.v2.demo-research-pilot.1",
      state: "running",
      config: pilotConfig(`outage-pilot-${suffix}`),
      scorecard: scorecard(),
      lineageEventIds: [],
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      updatedAt: new Date().toISOString(),
    }, { correlationId }),
    (error) => error instanceof V2PersistenceError && error.code === "database_unavailable",
  );
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
  await pool.query("DELETE FROM v2_orchestration_checkpoints WHERE consumer_id LIKE $1 OR source_event_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_consumer_acknowledgements WHERE acknowledgement_id LIKE $1 OR source_event_id LIKE $1 OR consumer_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
  await pool.query("DELETE FROM v2_orchestration_cycles WHERE cycle_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
}

function reportDate() {
  return `2099-05-${String((Date.now() % 20) + 1).padStart(2, "0")}`;
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

function dailyReport(reportId: string, date: string): V2DailyResearchReport {
  return {
    reportId,
    schemaVersion: "fincoach.v2.daily-research-report.1",
    reportDate: date,
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
    deadLetterEvents: 1,
    dataGaps: 0,
    staleDataIncidents: 0,
    moduleHealth: { orchestration: "healthy" },
    liveExecutionBlocked: true,
    createdAt: new Date().toISOString(),
  };
}
