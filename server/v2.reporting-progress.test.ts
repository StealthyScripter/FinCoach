import assert from "node:assert/strict";
import { V2PersistenceError } from "./v2/persistence/errors";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import { V2OperationsService } from "./v2/operations/service";

const now = new Date("2026-07-31T15:45:00.000Z");

await testDurableProgressCountsAndReadiness();
await testProgressProjectionFailureIsSanitized();
await testStatusCountsUseCurrentProjectionSources();
await testDataReconciliationDetectsMismatches();
await testInvalidDailyReportDateCannotBecomeLatest();
await testResearchProgressContractHasNonNullProvenance();
await testReportingProjectionFailureDoesNotFailDatabaseHealth();
await testMalformedDailyReportDoesNotMaskCanonicalProgress();

console.log("v2 reporting progress tests passed");

async function testDurableProgressCountsAndReadiness() {
  const sqlSeen: string[] = [];
  const repository = new PgV2OperationsRepository({
    query: async (sql: string) => {
      sqlSeen.push(sql);
      if (sql.includes("v2_detector_evaluations")) {
        assert.match(sql, /FROM v2_external_evaluations/);
        assert.match(sql, /FROM v2_research_journal_entries/);
        assert.match(sql, /FROM v2_learning_lessons/);
        assert.match(sql, /FROM v2_strategy_lifecycle_decisions/);
        assert.match(sql, /v2_research_hypotheses WHERE created_at >= \$2::timestamp - INTERVAL '24 hours'/);
        assert.match(sql, /v2_ranking_decisions WHERE created_at >= \$2::timestamp - INTERVAL '7 days'/);
        assert.match(sql, /status = 'attempted'/);
        return {
          rows: [{
            ...pipelineRow({
              observations: [1, 2, 3, 4],
              hypotheses: [0, 1, 1, 1],
              strategies: [0, 1, 1, 1],
              experiments: [0, 1, 1, 1],
              backtests: [0, 1, 1, 1],
              verdicts: [0, 1, 1, 1],
              ranked_candidates: [0, 1, 1, 1],
              forward_tests: [0, 1, 1, 1],
              signals: [0, 1, 1, 1],
              evaluations: [0, 1, 1, 1],
              journal_entries: [0, 1, 1, 1],
              lessons: [0, 1, 1, 1],
              lifecycle_decisions: [0, 1, 1, 1],
              pilot_scorecards: [0, 0, 0, 0],
              detector_evaluations: [2, 2, 2, 2],
            }),
            evaluations_attempted_hour: 1,
            evaluations_completed_hour: 1,
            duplicates_suppressed_hour: 0,
            failures_hour: 0,
            most_recent_market_data_timestamp: "2026-07-31T15:30:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("UNION ALL")) return { rows: [], rowCount: 0 };
      if (sql.includes("v2_orchestration_cycles")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    },
  } as never);

  const progress = await repository.researchProgress(now);
  assert.equal(progress.status, "ok");
  assert.equal(progress.source, "postgresql");
  assert.equal(progress.databaseBacked, true);
  assert.equal(progress.windows?.currentHour?.observations, 1);
  assert.equal(progress.windows?.running24Hours?.observations, 2);
  assert.equal(progress.windows?.running7Days?.observations, 3);
  assert.equal(progress.windows?.lifetime?.observations, 4);
  assert.equal(progress.windows?.running24Hours?.hypotheses, 1);
  assert.equal(progress.pipeline.observations, 4);
  assert.equal(progress.pipeline.evaluations, 1);
  assert.equal(progress.pipeline.journalEntries, 1);
  assert.equal(progress.pipeline.lessons, 1);
  assert.equal(progress.pipeline.lifecycleDecisions, 1);
  assert.deepEqual(progress.pipeline.detectorEvaluations, {
    recordsCurrentHour: 2,
    attemptedCurrentHour: 1,
    completedCurrentHour: 1,
    duplicatesSuppressedCurrentHour: 0,
    failuresCurrentHour: 0,
  });
  assert.deepEqual(progress.readiness, {
    currentStage: "lifecycle decision",
    nextStage: "research lifecycle complete",
    liveExecutionBlocked: true,
    paperExecutionState: "disabled_or_gated",
    demoExecutionState: "demo_only_gated",
  });
  assert.equal(sqlSeen.length, 3);
}

async function testProgressProjectionFailureIsSanitized() {
  const service = new V2OperationsService({
    operations: {
      latestReport: async () => null,
      getReportByDate: async () => null,
      saveReport: async record => ({ inserted: true, record }),
      saveDelivery: async record => ({ inserted: true, record }),
      researchProgress: async () => {
        throw new V2PersistenceError("database_unavailable", "database host and SQL should not be exposed");
      },
    },
  } as never);

  const response = await service.researchProgress();
  assert.equal(response.body.status, "degraded");
  assert.equal(response.body.degraded, true);
  assert.equal(response.body.reason, "database_unavailable");
  assert.equal(response.body.projectionError, "database_unavailable");
  assert.deepEqual(response.body.reportingSource, {
    source: "postgresql",
    databaseBacked: true,
    degraded: true,
    generatedAt: response.body.generatedAt,
    projectionError: "database_unavailable",
  });
  assert.equal(response.body.liveExecutionBlocked, true);
  assert.doesNotMatch(JSON.stringify(response.body), /host and SQL/);
}

async function testStatusCountsUseCurrentProjectionSources() {
  const service = new V2OperationsService({
    operations: progressRepository({ rankedCandidates: 11, evaluations: 12, journalEntries: 13, lessons: 14, lifecycleDecisions: 15 }),
    ranking: countRepository(7),
    evidence: {
      strategies: countRepository(3),
      evaluations: countRepository(4),
      journal: countRepository(5),
      lessons: countRepository(6),
      lifecycle: countRepository(2),
    },
  } as never);

  const response = await service.statusAsync({ correlationId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(response.body.rankedCandidates, 11);
  assert.equal(response.body.externalEvaluations, 12);
  assert.equal(response.body.journalEntries, 13);
  assert.equal(response.body.lessons, 14);
  assert.equal(response.body.lifecycleStates, 15);
  assert.equal((response.body.moduleAvailability as Record<string, unknown>).journal, "available");
  assert.deepEqual(response.body.reportingSource, { source: "postgresql", databaseBacked: true, degraded: false, generatedAt: now.toISOString(), projectionError: null });
}

async function testDataReconciliationDetectsMismatches() {
  const service = new V2OperationsService({
    operations: progressRepository({ observations: 10, hypotheses: 3, strategies: 2, experiments: 2, backtests: 1, verdicts: 1, rankedCandidates: 1, forwardTests: 0 }),
    ranking: countRepository(2),
    evidence: {
      observations: countRepository(10),
      hypotheses: countRepository(3),
      strategies: countRepository(2),
      experiments: countRepository(2),
      backtests: countRepository(1),
      "court-cases": countRepository(1),
      "forward-tests": countRepository(0),
      signals: countRepository(0),
      evaluations: countRepository(0),
      journal: countRepository(0),
      lessons: countRepository(0),
      lifecycle: countRepository(0),
    },
  } as never);

  const response = await service.dataReconciliation();
  assert.equal(response.body.overallStatus, "mismatch");
  const comparisons = response.body.comparisons as Array<Record<string, unknown>>;
  assert.deepEqual(comparisons.find(item => item.stage === "ranked candidates"), { stage: "ranked candidates", canonical: 1, repository: 2, status: "mismatch" });
  assert.match(await service.telegramDataReconciliation(), /ranked candidates: mismatch API=1 repo=2/);
}

async function testInvalidDailyReportDateCannotBecomeLatest() {
  const goodReport = reportRecord("2026-08-09", "2026-08-09T00:00:00.000Z");
  const repository = new PgV2OperationsRepository({
    query: async (sql: string) => {
      if (sql.includes("ORDER BY created_at")) {
        assert.match(sql, /v2_operations_daily_reports/);
        return { rows: [pgReportRow(goodReport)], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  } as never);
  const latest = await repository.latestReport();
  assert.equal(latest?.report.reportDate, "2026-08-09");

  const invalidOnly = await new PgV2OperationsRepository({ query: async () => ({ rows: [pgReportRow(reportRecord("2099-04-93", "2099-04-93T00:00:00.000Z"))], rowCount: 1 }) } as never).latestReport();
  assert.equal(invalidOnly, null);
}

async function testResearchProgressContractHasNonNullProvenance() {
  const service = new V2OperationsService({ operations: progressRepository({ observations: 2, hypotheses: 1 }) } as never);
  const response = await service.researchProgress();
  assert.equal(response.body.source, "postgresql");
  assert.equal(response.body.databaseBacked, true);
  assert.equal(response.body.degraded, false);
  assert.deepEqual(response.body.reportingSource, {
    source: "postgresql",
    databaseBacked: true,
    degraded: false,
    generatedAt: now.toISOString(),
    projectionError: null,
  });
  assert.equal((response.body.windows as Record<string, Record<string, unknown>>).lifetime.observations, 2);
  assert.equal((response.body.windows as Record<string, Record<string, unknown>>).total.observations, 2);
}

async function testReportingProjectionFailureDoesNotFailDatabaseHealth() {
  const service = new V2OperationsService({
    operations: {
      latestReport: async () => reportRecord("2026-08-09", "2026-08-09T00:00:00.000Z"),
      getReportByDate: async () => null,
      saveReport: async record => ({ inserted: true, record }),
      saveDelivery: async record => ({ inserted: true, record }),
      invalidDailyReportCount: async () => 0,
      researchProgress: async () => {
        throw new V2PersistenceError("migration_mismatch", "research projection tables missing");
      },
    },
  } as never);

  const response = await service.statusAsync();
  assert.equal(response.body.postgresqlHealth, "healthy");
  assert.equal(response.body.databaseHealth, "healthy");
  assert.equal((response.body.reportingProjection as Record<string, unknown>).state, "degraded");
  assert.equal((response.body.reportingProjection as Record<string, unknown>).projectionError, "migration_mismatch");
  assert.equal((response.body.reportingProjection as Record<string, unknown>).databaseBacked, true);
  assert.equal((response.body.reportingSource as Record<string, unknown>).degraded, true);
  assert.equal(response.body.observationsCreated, null);
  assert.deepEqual(response.body.durableCounts, { state: "unavailable", projectionError: "migration_mismatch" });
  assert.equal(response.body.degradedReason, "migration_mismatch");
}

async function testMalformedDailyReportDoesNotMaskCanonicalProgress() {
  const service = new V2OperationsService({
    operations: {
      ...progressRepository({ observations: 9, hypotheses: 2, rankedCandidates: 1 }),
      latestReport: async () => {
        throw new V2PersistenceError("malformed_persisted_record", "invalid daily report fixture");
      },
      invalidDailyReportCount: async () => 1,
    },
  } as never);

  const response = await service.statusAsync();
  assert.equal(response.body.postgresqlHealth, "healthy");
  assert.equal(response.body.databaseHealth, "healthy");
  assert.equal(response.body.observationsCreated, 9);
  assert.equal(response.body.hypothesesCreated, 2);
  assert.equal(response.body.rankedCandidates, 1);
  assert.deepEqual(response.body.reportingDataInvalid, { dailyReports: 1, code: "reporting_data_invalid" });
  assert.equal((response.body.reportingProjection as Record<string, unknown>).state, "available");
  assert.equal((response.body.reportingProjection as Record<string, unknown>).source, "postgresql");
}

function countRepository(total: number) {
  return {
    listPage: async () => ({ items: [], total }),
  };
}

function progressRepository(overrides: Record<string, number>) {
  const pipeline = {
    observations: 0,
    hypotheses: 0,
    strategies: 0,
    experiments: 0,
    backtests: 0,
    verdicts: 0,
    rankedCandidates: 0,
    forwardTests: 0,
    signals: 0,
    evaluations: 0,
    journalEntries: 0,
    lessons: 0,
    lifecycleDecisions: 0,
    pilotScorecards: 0,
    ...overrides,
    detectorEvaluations: { recordsCurrentHour: 0, attemptedCurrentHour: 0, completedCurrentHour: 0, duplicatesSuppressedCurrentHour: 0, failuresCurrentHour: 0 },
  };
  return {
    latestReport: async () => null,
    getReportByDate: async () => null,
    saveReport: async record => ({ inserted: true, record }),
    saveDelivery: async record => ({ inserted: true, record }),
    invalidDailyReportCount: async () => 0,
    researchProgress: async () => ({
      schemaVersion: "fincoach.v2.research-progress.1",
      status: "ok",
      generatedAt: now.toISOString(),
      source: "postgresql",
      databaseBacked: true,
      windows: {
        currentHour: pipeline,
        running24Hours: pipeline,
        running7Days: pipeline,
        lifetime: pipeline,
        total: pipeline,
      },
      pipeline,
    }),
  };
}

function pipelineRow(input: Record<string, [number, number, number, number]>) {
  return Object.fromEntries(Object.entries(input).flatMap(([alias, [hour, day, week, total]]) => [
    [`${alias}_current_hour`, hour],
    [`${alias}_24h`, day],
    [`${alias}_7d`, week],
    [`${alias}_total`, total],
  ]));
}

function reportRecord(reportDate: string, createdAt: string) {
  return {
    report: {
      reportId: `report-${reportDate}`,
      schemaVersion: "fincoach.v2.daily-research-report.1",
      reportDate,
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
      moduleHealth: {},
      liveExecutionBlocked: true,
      createdAt,
    },
    status: "created",
    correlationId: "00000000-0000-4000-8000-000000000001",
    causationId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function pgReportRow(record: ReturnType<typeof reportRecord>) {
  return {
    report_id: record.report.reportId,
    schema_version: record.report.schemaVersion,
    report_date: record.report.reportDate,
    status: record.status,
    payload: record.report,
    correlation_id: record.correlationId,
    causation_id: record.causationId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}
