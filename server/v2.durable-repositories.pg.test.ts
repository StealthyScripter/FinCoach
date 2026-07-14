import assert from "node:assert/strict";
import { createHash, randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgOrchestrationRepository } from "./v2/orchestration/pgRepository";
import { PgDemoResearchPilotRepository } from "./v2/pilot/pgRepository";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import type { DemoResearchPilotConfig, DemoResearchPilotScorecard } from "./v2/pilot/contracts";
import type { V2DailyResearchReport } from "./v2/operations/contracts";
import { V2PersistenceError } from "./v2/persistence/errors";

if (!process.env.DATABASE_URL) {
  console.log("v2 durable repository integration skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `it-${Date.now()}-${randomUUID().slice(0, 8)}`;
const orchestration = new PgOrchestrationRepository(pool);
const pilotRepository = new PgDemoResearchPilotRepository(pool);
const operations = new PgV2OperationsRepository(pool);

try {
  await pool.query("SELECT 1");
  await testOrchestrationDurability();
  await testPilotDurability();
  await testOperationsDurability();
  await testMalformedAndUnsupportedRows();
  console.log("v2 durable repository PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function testOrchestrationDurability() {
  const now = new Date().toISOString();
  const cycleId = `cycle-${suffix}`;
  const saved = await orchestration.saveCycle({
    cycleId,
    status: "requested",
    requestedBy: "integration-test",
    idempotencyKey: `cycle-key-${suffix}`,
    correlationId: `corr-${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(saved.inserted, true);
  const duplicate = await orchestration.saveCycle({
    cycleId,
    status: "requested",
    requestedBy: "integration-test",
    idempotencyKey: `cycle-key-${suffix}`,
    correlationId: `corr-${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(duplicate.conflict, "idempotent");
  const conflicting = await orchestration.saveCycle({
    cycleId: `cycle-conflict-${suffix}`,
    status: "requested",
    requestedBy: "other",
    idempotencyKey: `cycle-key-${suffix}`,
    correlationId: `corr-${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(conflicting.conflict, "conflicting");

  const acknowledgement = {
    sourceEventId: `event-${suffix}`,
    consumerId: `consumer-${suffix}`,
    idempotencyKey: `ack-${suffix}`,
    resultHash: hash("complete"),
    correlationId: `corr-${suffix}`,
    causationId: null,
  };
  const checkpoint = {
    consumerId: acknowledgement.consumerId,
    sourceEventId: acknowledgement.sourceEventId,
    idempotencyKey: `checkpoint-${suffix}`,
    checkpointedAt: now,
    attempt: 1,
    correlationId: `corr-${suffix}`,
  };
  const atomic = await orchestration.acknowledgeAndCheckpoint({ acknowledgement, checkpoint });
  assert.equal(atomic.acknowledgement.idempotencyKey, acknowledgement.idempotencyKey);
  assert.equal(atomic.checkpoint.sourceEventId, acknowledgement.sourceEventId);
  assert.equal((await orchestration.checkpointFor(acknowledgement.consumerId))?.attempt, 1);
  const ackDuplicate = await orchestration.acknowledge({ ...acknowledgement });
  assert.equal(ackDuplicate.conflict, "idempotent");
  const ackConflict = await orchestration.acknowledge({ ...acknowledgement, resultHash: hash("different") });
  assert.equal(ackConflict.conflict, "conflicting");

  const retry = await orchestration.saveRetry({
    sourceEventId: `retry-event-${suffix}`,
    consumerId: `retry-consumer-${suffix}`,
    idempotencyKey: `retry-${suffix}-1`,
    attempt: 1,
    maxAttempts: 2,
    exhausted: false,
    nextRetryAt: now,
    lastErrorCode: "retryable_dependency_failure",
    correlationId: `corr-${suffix}`,
    causationId: null,
  });
  assert.equal(retry.attempt, 1);
  const restartedRepository = new PgOrchestrationRepository(pool);
  assert.equal((await restartedRepository.retryFor(retry.sourceEventId, retry.consumerId))?.attempt, 1);
  await restartedRepository.saveRetry({ ...retry, idempotencyKey: `retry-${suffix}-2`, attempt: 2, exhausted: true, updatedAt: new Date().toISOString() });
  assert.equal((await restartedRepository.retryFor(retry.sourceEventId, retry.consumerId))?.exhausted, true);
  await assert.rejects(
    () => restartedRepository.saveRetry({ ...retry, idempotencyKey: `retry-${suffix}-old`, attempt: 1, exhausted: false, updatedAt: new Date().toISOString() }),
    (error) => error instanceof V2PersistenceError && error.code === "optimistic_concurrency_conflict",
  );

  const leaseName = `lease-${suffix}`;
  const leaseA = await Promise.all([
    orchestration.acquireLease({ leaseName, workerId: "worker-a", now: new Date(), ttlMs: 60_000, correlationId: `corr-${suffix}` }),
    orchestration.acquireLease({ leaseName, workerId: "worker-b", now: new Date(), ttlMs: 60_000, correlationId: `corr-${suffix}` }),
  ]);
  assert.equal(leaseA.filter(Boolean).length, 1);
  const activeLease = leaseA.find(Boolean);
  assert.ok(activeLease);
  assert.ok(await orchestration.renewLease({ leaseName, workerId: activeLease.workerId, fencingToken: activeLease.fencingToken, now: new Date(), ttlMs: 60_000, correlationId: `corr-${suffix}` }));
  assert.equal(await orchestration.renewLease({ leaseName, workerId: "wrong-worker", fencingToken: activeLease.fencingToken, now: new Date(), ttlMs: 60_000, correlationId: `corr-${suffix}` }), null);
  const recovered = await orchestration.acquireLease({ leaseName, workerId: "worker-recovered", now: new Date(Date.now() + 120_000), ttlMs: 60_000, correlationId: `corr-${suffix}` });
  assert.ok(recovered);
  assert.notEqual(recovered.fencingToken, activeLease.fencingToken);
  assert.equal(await orchestration.renewLease({ leaseName, workerId: activeLease.workerId, fencingToken: activeLease.fencingToken, now: new Date(Date.now() + 120_001), ttlMs: 60_000, correlationId: `corr-${suffix}` }), null);

  const deadLetter = await orchestration.addDeadLetter({
    deadLetterId: `dead-${suffix}`,
    sourceEventId: `dead-event-${suffix}`,
    reason: "poison_event",
    createdAt: now,
    retryable: false,
    payload: { test: suffix },
    correlationId: `corr-${suffix}`,
  });
  assert.equal(deadLetter.inserted, true);
  await orchestration.recordDeadLetterReplay(`dead-${suffix}`);
  assert.ok((await orchestration.deadLetters()).some((record) => record.deadLetterId === `dead-${suffix}`));
}

async function testPilotDurability() {
  const config = pilotConfig(`pilot-${suffix}`);
  const initial = await pilotRepository.saveInitial({
    pilotId: config.pilotId,
    schemaVersion: "fincoach.v2.demo-research-pilot.1",
    state: "running",
    config,
    scorecard: emptyScorecard(),
    lineageEventIds: [],
    startedAt: config.pilotStartTime,
    stoppedAt: null,
    updatedAt: config.pilotStartTime,
  }, { correlationId: `corr-${suffix}` });
  assert.equal(initial.inserted, true);
  const duplicate = await pilotRepository.saveInitial(initial.pilot, { correlationId: `corr-${suffix}` });
  assert.equal(duplicate.inserted, false);

  const concurrent = await Promise.all([
    pilotRepository.transition({ pilotId: config.pilotId, expectedState: "running", toState: "paused", idempotencyKey: `pilot-trans-a-${suffix}`, correlationId: `corr-${suffix}` }),
    pilotRepository.transition({ pilotId: config.pilotId, expectedState: "running", toState: "degraded", idempotencyKey: `pilot-trans-b-${suffix}`, correlationId: `corr-${suffix}` }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "transitioned").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "conflict").length, 1);
  const paused = await pilotRepository.get(config.pilotId);
  assert.ok(paused);
  const updatedScorecard = { ...emptyScorecard(), observationsGenerated: 3, deadLetterEvents: 1 };
  const scored = await pilotRepository.updateScorecard({
    pilotId: config.pilotId,
    scorecard: updatedScorecard,
    lineageEventIds: [`event-${suffix}`],
    idempotencyKey: `score-${suffix}-1`,
    correlationId: `corr-${suffix}`,
  });
  assert.equal(scored.scorecard.observationsGenerated, 3);
  assert.deepEqual(scored.lineageEventIds, [`event-${suffix}`]);

  const stopped = await pilotRepository.transition({ pilotId: config.pilotId, expectedState: scored.state, toState: "stopped", idempotencyKey: `safe-stop-${suffix}`, correlationId: `corr-${suffix}` });
  assert.equal(stopped.status, "transitioned");
  assert.equal((await pilotRepository.get(config.pilotId))?.state, "stopped");
}

async function testOperationsDurability() {
  const report = dailyReport(`report-${suffix}`, `2099-01-${String(Date.now()).slice(-2)}`);
  const saved = await operations.saveReport({
    report,
    status: "created",
    correlationId: `corr-${suffix}`,
    causationId: null,
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  });
  assert.equal(saved.inserted, true);
  assert.equal((await operations.getReportByDate(report.reportDate))?.report.reportId, report.reportId);
  const duplicate = await operations.saveReport(saved.record);
  assert.equal(duplicate.conflict, "idempotent");

  const failedDelivery = await operations.saveDelivery({
    deliveryId: `delivery-failed-${suffix}`,
    reportId: report.reportId,
    destination: "telegram:redacted-test-chat",
    deliveryAttempt: 1,
    idempotencyKey: `delivery-${suffix}-1`,
    status: "failed",
    errorCode: "fixture_failure",
    errorMessage: "redacted failure",
    correlationId: `corr-${suffix}`,
    causationId: null,
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  });
  assert.equal(failedDelivery.inserted, true);
  assert.equal(failedDelivery.record.status, "failed");
  const duplicateDelivery = await operations.saveDelivery(failedDelivery.record);
  assert.equal(duplicateDelivery.conflict, "idempotent");
  await assert.rejects(
    () => operations.saveDelivery({ ...failedDelivery.record, deliveryId: `delivery-ambiguous-${suffix}`, deliveryAttempt: 2, idempotencyKey: `delivery-${suffix}-2`, status: "ambiguous" }),
    (error) => error instanceof V2PersistenceError && error.code === "persistence_integrity_failure",
  );
  assert.equal((await operations.deliveriesForReport(report.reportId))[0]?.status, "failed");
}

async function testMalformedAndUnsupportedRows() {
  const malformedReportId = `report-malformed-${suffix}`;
  await pool.query(
    `INSERT INTO v2_operations_daily_reports
      (report_id, schema_version, report_date, idempotency_key, status, payload, correlation_id, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'created', $4, $5, $6, $6)`,
    [malformedReportId, "fincoach.v2.daily-research-report.1", `malformed-${suffix}`, JSON.stringify({ schemaVersion: "wrong", reportId: "other", reportDate: "other" }), `corr-${suffix}`, new Date().toISOString()],
  );
  await assert.rejects(
    () => operations.getReportByDate(`malformed-${suffix}`),
    (error) => error instanceof V2PersistenceError && error.code === "malformed_persisted_record",
  );

  await pool.query(
    `INSERT INTO v2_orchestration_dead_letters
      (dead_letter_id, schema_version, source_event_id, reason, retryable, correlation_id, payload, created_at)
     VALUES ($1, 'fincoach.v2.future', $2, 'poison_event', false, $3, '{}'::jsonb, $4)`,
    [`dead-future-${suffix}`, `dead-future-event-${suffix}`, `corr-${suffix}`, new Date().toISOString()],
  );
  await assert.rejects(
    () => orchestration.deadLetters(),
    (error) => error instanceof V2PersistenceError && error.code === "unsupported_schema_version",
  );
}

async function cleanup() {
  const patterns = [`%${suffix}%`];
  for (const pattern of patterns) {
    await pool.query("DELETE FROM v2_operations_daily_report_deliveries WHERE delivery_id LIKE $1 OR report_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
    await pool.query("DELETE FROM v2_operations_daily_reports WHERE report_id LIKE $1 OR report_date LIKE $1 OR idempotency_key LIKE $1", [pattern]);
    await pool.query("DELETE FROM v2_pilot_reports WHERE report_id LIKE $1 OR pilot_id LIKE $1 OR idempotency_key LIKE $1", [pattern]);
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
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
    safeStopConditions: ["test-complete"],
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
