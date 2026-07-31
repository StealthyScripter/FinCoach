import assert from "node:assert/strict";
import { V2PersistenceError } from "./v2/persistence/errors";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import { V2OperationsService } from "./v2/operations/service";

const now = new Date("2026-07-31T15:45:00.000Z");

await testDurableProgressCountsAndReadiness();
await testProgressProjectionFailureIsSanitized();
await testStatusCountsUseCurrentProjectionSources();

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
        assert.match(sql, /status = 'attempted'/);
        return {
          rows: [{
            observations_current_hour: 1,
            observations_24h: 1,
            observations_7d: 1,
            observations_total: 1,
            hypotheses: 1,
            strategies: 1,
            experiments: 1,
            backtests: 1,
            verdicts: 1,
            ranked_candidates: 1,
            forward_tests: 1,
            signals: 1,
            evaluations: 1,
            journal_entries: 1,
            lessons: 1,
            lifecycle_decisions: 1,
            pilot_scorecards: 0,
            evaluations_records_hour: 2,
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
  assert.equal(response.body.liveExecutionBlocked, true);
  assert.doesNotMatch(JSON.stringify(response.body), /host and SQL/);
}

async function testStatusCountsUseCurrentProjectionSources() {
  const service = new V2OperationsService({
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
  assert.equal(response.body.rankedCandidates, 7);
  assert.equal(response.body.externalEvaluations, 4);
  assert.equal(response.body.journalEntries, 5);
  assert.equal(response.body.lessons, 6);
  assert.equal(response.body.lifecycleStates, 2);
}

function countRepository(total: number) {
  return {
    listPage: async () => ({ items: [], total }),
  };
}
