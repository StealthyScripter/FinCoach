import { Client } from "pg";
import { loadMigrationFiles, redactDatabaseUrl } from "./migrationSafety";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const requiredTables = [
  "execution_submission_idempotency",
  "semi_autonomous_approvals",
  "execution_audit_exports",
  "marketpilot_events",
  "execution_audit_entries",
  "vector_records",
  "demo_run_records",
  "telegram_deliveries",
  "telegram_summaries",
  "telegram_scheduler_runs",
  "telegram_command_audit",
  "telegram_lifecycle_state",
  "telegram_update_cursors",
  "v2_operations_daily_reports",
  "v2_operations_daily_report_deliveries",
];

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const identity = await client.query("SELECT current_database() AS database, current_user AS user, inet_server_addr()::text AS host, inet_server_port() AS port");
  const migrationState = await tableExists("fincoach_schema_migrations")
    ? await client.query("SELECT migration_id, checksum, status, applied_at FROM fincoach_schema_migrations ORDER BY migration_id")
    : { rows: [] };
  const tableReports = [];
  for (const table of requiredTables) {
    const present = await tableExists(table);
    const rowCount = present ? Number((await client.query(`SELECT count(*)::bigint AS count FROM ${quoteIdent(table)}`)).rows[0].count) : null;
    const indexes = present ? (await client.query("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 ORDER BY indexname", [table])).rows.map((row) => row.indexname) : [];
    const constraints = present ? (await client.query("SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname", [table])).rows.map((row) => row.conname) : [];
    tableReports.push({ table, present, rowCount, suspiciouslyEmpty: present && rowCount === 0, indexes, constraints });
  }
  const tracked = loadMigrationFiles();
  const applied = new Map(migrationState.rows.filter((row: { status: string }) => row.status === "applied").map((row: { migration_id: string; checksum: string }) => [row.migration_id, row]));
  const pending = tracked.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
  const checksumMismatches = tracked.filter((migration) => applied.get(migration.id)?.checksum !== undefined && applied.get(migration.id)?.checksum !== migration.checksum).map((migration) => migration.id);
  const partial = migrationState.rows.filter((row: { status: string }) => row.status !== "applied").map((row: { migration_id: string }) => row.migration_id);
  const missingTables = tableReports.filter((item) => !item.present).map((item) => item.table);
  const suspiciouslyEmptyTables = tableReports.filter((item) => item.suspiciouslyEmpty).map((item) => item.table);
  const missingIndexes = tableReports.filter((item) => item.present && item.indexes.length === 0).map((item) => item.table);
  const missingConstraints = tableReports.filter((item) => item.present && item.constraints.length === 0).map((item) => item.table);
  const verdict =
    missingTables.length || checksumMismatches.length || partial.length ? "incident_detected" :
    pending.length || suspiciouslyEmptyTables.length || missingIndexes.length || missingConstraints.length ? "degraded" :
    "healthy";
  await client.query("COMMIT");
  console.log(JSON.stringify({
    verdict,
    checkedAt: new Date().toISOString(),
    databaseIdentity: { ...identity.rows[0], url: redactDatabaseUrl(databaseUrl) },
    schemaVersion: migrationState.rows.filter((row: { status: string }) => row.status === "applied").at(-1)?.migration_id ?? null,
    migrations: { tablePresent: migrationState.rows.length > 0, rows: migrationState.rows, pending, checksumMismatches, partial },
    tables: tableReports,
    missingTables,
    suspiciouslyEmptyTables,
    missingIndexes,
    missingConstraints,
  }, null, 2));
  if (verdict === "incident_detected" || verdict === "unable_to_assess") process.exitCode = 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.log(JSON.stringify({
    verdict: "unable_to_assess",
    checkedAt: new Date().toISOString(),
    databaseIdentity: { url: safeRedact(databaseUrl) },
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await client.end();
}

async function tableExists(table: string) {
  const result = await client.query("SELECT to_regclass($1) AS name", [table]);
  return Boolean(result.rows[0]?.name);
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeRedact(value: string) {
  try {
    return redactDatabaseUrl(value);
  } catch {
    return "malformed";
  }
}
