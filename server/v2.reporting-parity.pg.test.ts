import assert from "node:assert/strict";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgV2OperationsRepository } from "./v2/operations/pgRepository";
import { V2OperationsService } from "./v2/operations/service";

if (!process.env.DATABASE_URL) {
  console.log("v2 reporting postgres parity tests skipped: DATABASE_URL not set");
} else {
  await bootstrapTestDatabase();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const suffix = `reporting-parity-${Date.now()}`;
  try {
    const baseline = await durableCounts(client);
    await seed(client, suffix);
    const operations = new PgV2OperationsRepository(client);
    const progress = await operations.researchProgress(new Date("2026-08-09T15:30:00.000Z"));
    assert.equal(progress.pipeline.observations - baseline.observations, 10);
    assert.equal(progress.pipeline.hypotheses - baseline.hypotheses, 3);
    assert.equal(progress.pipeline.strategies - baseline.strategies, 2);
    assert.equal(progress.pipeline.experiments - baseline.experiments, 2);
    assert.equal(progress.pipeline.backtests - baseline.backtests, 1);
    assert.equal(progress.pipeline.verdicts - baseline.verdicts, 1);
    assert.equal(progress.pipeline.rankedCandidates - baseline.rankedCandidates, 1);
    assert.equal(progress.pipeline.forwardTests - baseline.forwardTests, 0);
    assert.equal(progress.pipeline.signals - baseline.signals, 0);
    assert.equal(progress.pipeline.evaluations - baseline.evaluations, 0);
    assert.equal(progress.pipeline.journalEntries - baseline.journalEntries, 0);
    assert.equal(progress.pipeline.lessons - baseline.lessons, 0);
    assert.equal(progress.pipeline.lifecycleDecisions - baseline.lifecycleDecisions, 0);
    assert.equal(Number(progress.windows?.currentHour?.observations ?? 0) - baseline.currentHourObservations, 1);
    assert.equal(Number(progress.windows?.running24Hours?.observations ?? 0) - baseline.running24HoursObservations, 4);
    assert.equal(Number(progress.windows?.running7Days?.observations ?? 0) - baseline.running7DaysObservations, 7);
    assert.equal(Number(progress.windows?.lifetime?.observations ?? 0) - baseline.observations, 10);

    const service = new V2OperationsService({
      operations,
      ranking: sqlCount(client, "v2_ranking_decisions"),
      evidence: {
        observations: sqlCount(client, "v2_market_observations"),
        hypotheses: sqlCount(client, "v2_research_hypotheses"),
        strategies: sqlCount(client, "v2_strategy_definitions"),
        experiments: sqlCount(client, "v2_research_experiments"),
        backtests: sqlCount(client, "v2_backtest_results"),
        "court-cases": sqlCount(client, "v2_court_verdicts"),
        "forward-tests": sqlCount(client, "v2_forward_tests"),
        signals: sqlCount(client, "v2_research_signals"),
        evaluations: sqlCount(client, "v2_external_evaluations"),
        journal: sqlCount(client, "v2_research_journal_entries"),
        lessons: sqlCount(client, "v2_learning_lessons"),
        lifecycle: sqlCount(client, "v2_strategy_lifecycle_decisions"),
      },
    } as never);
    const status = await service.statusAsync();
    assert.equal(status.body.postgresqlHealth, "healthy");
    assert.equal((status.body.reportingProjection as Record<string, unknown>).state, "available");
    assert.equal((status.body.reportingProjection as Record<string, unknown>).source, "postgresql");
    assert.equal(status.body.observationsCreated, progress.pipeline.observations);
    assert.equal(status.body.hypothesesCreated, progress.pipeline.hypotheses);
    assert.equal(status.body.experimentsQueued, progress.pipeline.experiments);
    assert.equal(status.body.backtestsCompleted, progress.pipeline.backtests);
    assert.equal(status.body.courtroomVerdicts, progress.pipeline.verdicts);
    assert.equal(status.body.rankedCandidates, progress.pipeline.rankedCandidates);
    assert.equal(status.body.forwardTests, progress.pipeline.forwardTests);
    assert.equal(status.body.signals, progress.pipeline.signals);
    assert.equal(status.body.externalEvaluations, progress.pipeline.evaluations);
    assert.equal(status.body.journalEntries, progress.pipeline.journalEntries);
    assert.equal(status.body.lessons, progress.pipeline.lessons);
    assert.equal(status.body.lifecycleStates, progress.pipeline.lifecycleDecisions);
    const reconciliation = await service.dataReconciliation();
    assert.equal(reconciliation.body.overallStatus, "match");
    for (const item of reconciliation.body.comparisons as Array<Record<string, unknown>>) {
      assert.equal(item.status, "match", `${item.stage} should reconcile`);
    }
  } finally {
    await cleanup(client, suffix);
    assert.equal(await seededRowCount(client, suffix), 0);
    await client.end();
  }
  console.log("v2 reporting postgres parity tests passed");
}

async function seed(client: Client, suffix: string) {
  const now = "2026-08-09T15:15:00.000Z";
  const lastDay = "2026-08-09T02:00:00.000Z";
  const lastWeek = "2026-08-05T12:00:00.000Z";
  const old = "2026-07-20T12:00:00.000Z";
  await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", 1, now);
  await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", 2, lastDay);
  await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", 3, lastDay);
  await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", 4, lastDay);
  for (let i = 5; i <= 7; i++) await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", i, lastWeek);
  for (let i = 8; i <= 10; i++) await insertGeneric(client, "v2_market_observations", suffix, "fincoach.v2.observation.1", "observations", i, old);
  await insertMany(client, "v2_research_hypotheses", suffix, "fincoach.v2.hypothesis.1", "hypothesis", 3, now);
  await insertMany(client, "v2_strategy_definitions", suffix, "fincoach.v2.strategy.1", "rules", 2, now);
  await insertMany(client, "v2_research_experiments", suffix, "fincoach.v2.experiment.1", "experiments", 2, now);
  await insertMany(client, "v2_backtest_results", suffix, "fincoach.v2.backtest.1", "backtesting", 1, now);
  await insertMany(client, "v2_court_verdicts", suffix, "fincoach.v2.court-verdict.1", "courtroom", 1, now);
  await insertGeneric(client, "v2_ranking_decisions", suffix, "fincoach.v2.ranking.1", "ranking", 1, now, {
    candidates: [{ strategyId: `${suffix}-strategy-1`, rank: 1, courtVerdict: "approved_for_forward_test" }],
  });
}

async function insertMany(client: Client, table: string, suffix: string, schemaVersion: string, sourceModule: string, count: number, createdAt: string) {
  for (let i = 1; i <= count; i++) await insertGeneric(client, table, suffix, schemaVersion, sourceModule, i, createdAt);
}

async function insertGeneric(client: Client, table: string, suffix: string, schemaVersion: string, sourceModule: string, index: number, createdAt: string, payload: Record<string, unknown> = {}) {
  const id = `${suffix}-${table}-${index}`;
  await client.query(
    `INSERT INTO ${table}
      (record_id, schema_version, natural_key, idempotency_key, source_module, payload, lineage_event_ids, correlation_id, causation_id, created_at)
     VALUES ($1, $2, $1, $1, $3, $4, '[]'::jsonb, $5, null, $6)
     ON CONFLICT (record_id) DO NOTHING`,
    [id, schemaVersion, sourceModule, JSON.stringify({ schemaVersion, recordId: id, correlationId: suffix, lineageEventIds: [], createdAt, ...payload }), suffix, createdAt],
  );
}

function sqlCount(client: Client, table: string) {
  return {
    listPage: async () => {
      const result = await client.query(`SELECT count(*)::int AS total FROM ${table}`);
      return { items: [], total: Number(result.rows[0]?.total ?? 0) };
    },
  };
}

async function durableCounts(client: Client) {
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM v2_market_observations) AS observations,
      (SELECT count(*)::int FROM v2_research_hypotheses) AS hypotheses,
      (SELECT count(*)::int FROM v2_strategy_definitions) AS strategies,
      (SELECT count(*)::int FROM v2_research_experiments) AS experiments,
      (SELECT count(*)::int FROM v2_backtest_results) AS backtests,
      (SELECT count(*)::int FROM v2_court_verdicts) AS verdicts,
      (SELECT COALESCE(sum(jsonb_array_length(CASE WHEN jsonb_typeof(payload->'candidates') = 'array' THEN payload->'candidates' ELSE '[]'::jsonb END)), 0)::int FROM v2_ranking_decisions) AS ranked_candidates,
      (SELECT count(*)::int FROM v2_forward_tests) AS forward_tests,
      (SELECT count(*)::int FROM v2_research_signals) AS signals,
      (SELECT count(*)::int FROM v2_external_evaluations) AS evaluations,
      (SELECT count(*)::int FROM v2_research_journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM v2_learning_lessons) AS lessons,
      (SELECT count(*)::int FROM v2_strategy_lifecycle_decisions) AS lifecycle_decisions,
      (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $1::timestamp) AS current_hour_observations,
      (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $2::timestamp - INTERVAL '24 hours') AS running_24h_observations,
      (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $2::timestamp - INTERVAL '7 days') AS running_7d_observations`,
    ["2026-08-09T15:00:00.000Z", "2026-08-09T15:30:00.000Z"],
  );
  const row = result.rows[0] ?? {};
  return {
    observations: Number(row.observations ?? 0),
    hypotheses: Number(row.hypotheses ?? 0),
    strategies: Number(row.strategies ?? 0),
    experiments: Number(row.experiments ?? 0),
    backtests: Number(row.backtests ?? 0),
    verdicts: Number(row.verdicts ?? 0),
    rankedCandidates: Number(row.ranked_candidates ?? 0),
    forwardTests: Number(row.forward_tests ?? 0),
    signals: Number(row.signals ?? 0),
    evaluations: Number(row.evaluations ?? 0),
    journalEntries: Number(row.journal_entries ?? 0),
    lessons: Number(row.lessons ?? 0),
    lifecycleDecisions: Number(row.lifecycle_decisions ?? 0),
    currentHourObservations: Number(row.current_hour_observations ?? 0),
    running24HoursObservations: Number(row.running_24h_observations ?? 0),
    running7DaysObservations: Number(row.running_7d_observations ?? 0),
  };
}

async function seededRowCount(client: Client, suffix: string) {
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM v2_ranking_decisions WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_court_verdicts WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_backtest_results WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_research_experiments WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_strategy_definitions WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_research_hypotheses WHERE correlation_id = $1)
      + (SELECT count(*)::int FROM v2_market_observations WHERE correlation_id = $1) AS total`,
    [suffix],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function cleanup(client: Client, suffix: string) {
  for (const table of [
    "v2_ranking_decisions",
    "v2_court_verdicts",
    "v2_backtest_results",
    "v2_research_experiments",
    "v2_strategy_definitions",
    "v2_research_hypotheses",
    "v2_market_observations",
  ]) {
    await client.query(`DELETE FROM ${table} WHERE correlation_id = $1`, [suffix]);
  }
}
