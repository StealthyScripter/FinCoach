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
] as const;

export async function bootstrapTestDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const migrationPath of TEST_MIGRATIONS) {
      await client.query(readFileSync(migrationPath, "utf-8"));
    }
  } finally {
    await client.end();
  }
}
