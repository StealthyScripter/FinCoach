import assert from "node:assert/strict";
import { Client } from "pg";
import { loadMigrationFiles } from "../scripts/db/migrationSafety";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
assert.equal(process.env.FINCOACH_TEST_DB_DISPOSABLE, "true", "official PostgreSQL tests must run in disposable mode");
assert.ok(databaseUrl, "disposable TEST_DATABASE_URL is required");

const parsed = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname), "test database must be localhost-only");
assert.match(parsed.pathname.replace(/^\//, ""), /disposable|test|tmp|temp/i, "test database name must be marked disposable");
assert.equal(process.env.OANDA_API_TOKEN, "");
assert.equal(process.env.OANDA_ACCOUNT_ID, "");
assert.equal(process.env.FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED, "false");

const migrations = loadMigrationFiles();
const numericPrefixes = migrations.map((migration) => migration.filename.slice(0, 4));
assert.equal(new Set(numericPrefixes).size, numericPrefixes.length, "duplicate migration numeric prefixes are not allowed");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const pending = await client.query("SELECT migration_id FROM fincoach_schema_migrations WHERE status <> 'applied' ORDER BY migration_id");
  assert.deepEqual(pending.rows, [], "all migrations must be applied");

  const applied = await client.query("SELECT migration_id, checksum FROM fincoach_schema_migrations ORDER BY migration_id");
  assert.equal(applied.rowCount, migrations.length, "migration ledger should contain every migration");
  assert.equal(new Set(applied.rows.map((row) => row.migration_id)).size, migrations.length, "duplicate migration IDs are not allowed");
  for (const migration of migrations) {
    const row = applied.rows.find((item) => item.migration_id === migration.id);
    assert.ok(row, `${migration.id} must be in migration ledger`);
    assert.equal(row.checksum, migration.checksum, `${migration.id} checksum should match`);
  }

  const table = await client.query("SELECT to_regclass('trade_forensics') AS name");
  assert.equal(table.rows[0]?.name, "trade_forensics");

  const constraints = await client.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'trade_forensics'
    ORDER BY constraint_name
  `);
  assert.ok(constraints.rows.some((row) => row.constraint_type === "UNIQUE" && String(row.constraint_name).includes("trade_id")), "trade_forensics.trade_id must be unique");

  const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE tablename = 'trade_forensics' ORDER BY indexname");
  const indexNames = indexes.rows.map((row) => String(row.indexname));
  assert.ok(indexNames.includes("idx_trade_forensics_symbol_closed_at"));
  assert.ok(indexNames.includes("idx_trade_forensics_broker_trade_id"));
} finally {
  await client.end();
}

console.log("disposable test database validation passed");
