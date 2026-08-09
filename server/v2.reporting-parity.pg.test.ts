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
    await seed(client, suffix);
    const operations = new PgV2OperationsRepository(client);
    const progress = await operations.researchProgress(new Date("2026-08-09T15:30:00.000Z"));
    assert.equal(progress.pipeline.observations, 10);
    assert.equal(progress.pipeline.hypotheses, 3);
    assert.equal(progress.pipeline.strategies, 2);
    assert.equal(progress.pipeline.experiments, 2);
    assert.equal(progress.pipeline.backtests, 1);
    assert.equal(progress.pipeline.verdicts, 1);
    assert.equal(progress.pipeline.rankedCandidates, 1);
    assert.equal(progress.pipeline.forwardTests, 0);
    assert.equal(progress.windows?.currentHour?.observations, 1);
    assert.equal(progress.windows?.running24Hours?.observations, 4);
    assert.equal(progress.windows?.running7Days?.observations, 7);
    assert.equal(progress.windows?.lifetime?.observations, 10);

    const service = new V2OperationsService({
      operations,
      ranking: sqlCount(client, "v2_ranking_decisions", suffix),
      evidence: {
        observations: sqlCount(client, "v2_market_observations", suffix),
        hypotheses: sqlCount(client, "v2_research_hypotheses", suffix),
        strategies: sqlCount(client, "v2_strategy_definitions", suffix),
        experiments: sqlCount(client, "v2_research_experiments", suffix),
        backtests: sqlCount(client, "v2_backtest_results", suffix),
        "court-cases": sqlCount(client, "v2_court_verdicts", suffix),
        "forward-tests": sqlCount(client, "v2_forward_tests", suffix),
        signals: sqlCount(client, "v2_research_signals", suffix),
        evaluations: sqlCount(client, "v2_external_evaluations", suffix),
        journal: sqlCount(client, "v2_research_journal_entries", suffix),
        lessons: sqlCount(client, "v2_learning_lessons", suffix),
        lifecycle: sqlCount(client, "v2_strategy_lifecycle_decisions", suffix),
      },
    } as never);
    const status = await service.statusAsync();
    assert.equal(status.body.observationsCreated, 10);
    assert.equal(status.body.hypothesesCreated, 3);
    assert.equal(status.body.rankedCandidates, 1);
    const reconciliation = await service.dataReconciliation();
    assert.equal(reconciliation.body.overallStatus, "match");
  } finally {
    await cleanup(client, suffix);
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
  await insertMany(client, "v2_ranking_decisions", suffix, "fincoach.v2.ranking.1", "ranking", 1, now);
}

async function insertMany(client: Client, table: string, suffix: string, schemaVersion: string, sourceModule: string, count: number, createdAt: string) {
  for (let i = 1; i <= count; i++) await insertGeneric(client, table, suffix, schemaVersion, sourceModule, i, createdAt);
}

async function insertGeneric(client: Client, table: string, suffix: string, schemaVersion: string, sourceModule: string, index: number, createdAt: string) {
  const id = `${suffix}-${table}-${index}`;
  await client.query(
    `INSERT INTO ${table}
      (record_id, schema_version, natural_key, idempotency_key, source_module, payload, lineage_event_ids, correlation_id, causation_id, created_at)
     VALUES ($1, $2, $1, $1, $3, $4, '[]'::jsonb, $5, null, $6)
     ON CONFLICT (record_id) DO NOTHING`,
    [id, schemaVersion, sourceModule, JSON.stringify({ schemaVersion, recordId: id, correlationId: suffix, lineageEventIds: [], createdAt }), suffix, createdAt],
  );
}

function sqlCount(client: Client, table: string, suffix: string) {
  return {
    listPage: async () => {
      const result = await client.query(`SELECT count(*)::int AS total FROM ${table} WHERE correlation_id = $1`, [suffix]);
      return { items: [], total: Number(result.rows[0]?.total ?? 0) };
    },
  };
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
