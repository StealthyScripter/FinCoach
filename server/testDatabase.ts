import { readFileSync } from "node:fs";
import { Client } from "pg";

const TEST_MIGRATIONS = [
  "migrations/0001_marketpilot_core.sql",
  "migrations/0002_execution_reliability.sql",
  "migrations/0003_execution_governance.sql",
  "migrations/0004_memory_persistence.sql",
  "migrations/0005_vector_persistence.sql",
  "migrations/0006_rag_corpus_persistence.sql",
  "migrations/0007_ai_evaluations_persistence.sql",
  "migrations/0008_ingestion_runs_persistence.sql",
  "migrations/0009_time_series_persistence.sql",
  "migrations/0010_strategy_evidence_persistence.sql",
  "migrations/0011_demo_run_records.sql",
  "migrations/0012_telegram_operations.sql",
  "migrations/0013_telegram_update_cursor.sql",
  "migrations/0014_v2_operational_persistence.sql",
  "migrations/0015_v2_evidence_persistence.sql",
  "migrations/0016_v2_research_lineage_persistence.sql",
  "migrations/0017_v2_research_pipeline_repair.sql",
  "migrations/0018_weekly_research_session_notifications.sql",
  "migrations/0019_operational_blockers.sql",
  "migrations/0020_auth_and_portfolio_platform.sql",
] as const;

const TEST_MIGRATION_LOCK_ID = 71420260809;

export async function bootstrapTestDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [TEST_MIGRATION_LOCK_ID]);
    for (const migrationPath of TEST_MIGRATIONS) {
      await client.query(readFileSync(migrationPath, "utf-8"));
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [TEST_MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}
