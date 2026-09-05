import { Client } from "pg";
import { assertDisposableLocalDatabase } from "../scripts/db/dbLifecycle";
import { loadMigrationFiles } from "../scripts/db/migrationSafety";

const TEST_MIGRATION_LOCK_ID = 71420260809;

export async function bootstrapTestDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return;
  assertDisposableLocalDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [TEST_MIGRATION_LOCK_ID]);
    for (const migration of loadMigrationFiles()) {
      await client.query(migration.sql);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [TEST_MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}
