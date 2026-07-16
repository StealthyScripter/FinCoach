import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { Client } from "pg";
import { findDestructiveDdl, loadMigrationFiles, redactDatabaseUrl, requireBackupGate, type MigrationFile } from "./migrationSafety";
import { currentCommit, pgRestoreListWithPolicy, resolvePostgresTools, runPgDumpToFile, runPgRestoreToDatabase, sha256File, verifyBackupArtifact } from "./dbLifecycle";
import { assessMigrations } from "./migrationAssessment";

const command = process.argv[2] ?? "migrate";
const args = process.argv.slice(3);
const migrations = loadMigrationFiles();

if (command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage:
  npm run db:migrate -- [--dry-run|--plan]
  npm run db:migrate:status
  npm run db:migrate:verify
  npm run db:migrate:assess
  npm run db:migrate:baseline -- --all-equivalent --backup /path/backup.dump --checksum /path/backup.dump.sha256 [--dry-run]
  npm run db:backup
  npm run db:restore:verify -- --backup /path/backup.dump [--checksum /path/backup.dump.sha256] [--keep-temp-on-failure]

Production migrations are noninteractive, versioned, checksummed, and additive by default.
Destructive DDL requires the separate FINCOACH_DB_BREAK_GLASS_DESTRUCTIVE_DDL=true gate.`);
  process.exit(0);
}

if (command === "backup") {
  await runBackup();
  process.exit(0);
}

if (command === "restore:verify") {
  await runRestoreVerify();
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (command === "assess") {
    await printAssessment();
    process.exit(0);
  }
  if (command === "baseline") {
    await baselineEquivalentMigrations();
    process.exit(0);
  }
  if (command === "migrate") await ensureLedger();
  const state = await readState(command === "status");
  const destructive = findDestructiveDdl(migrations);
  if (destructive.length && process.env.FINCOACH_DB_BREAK_GLASS_DESTRUCTIVE_DDL !== "true") {
    throw new Error(`destructive DDL rejected: ${destructive.map((item) => `${item.migrationId}: ${item.reason}`).join("; ")}`);
  }

  if (command === "status") {
    await printStatus(state);
  } else if (command === "verify") {
    await verify(state);
  } else if (command === "migrate") {
    requireBackupGate(args, process.env);
    await migrate(state);
  } else {
    throw new Error(`unknown migration command: ${command}`);
  }
} finally {
  await client.end();
}

async function ensureLedger() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS fincoach_schema_migrations (
      migration_id text PRIMARY KEY,
      filename text NOT NULL,
      checksum text NOT NULL,
      status text NOT NULL CHECK (status IN ('running', 'applied')),
      started_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz,
      execution_ms integer,
      error_message text
    )
  `);
}

async function readState(allowMissingLedger = false) {
  const exists = await client.query("SELECT to_regclass('fincoach_schema_migrations') AS ledger");
  if (!exists.rows[0]?.ledger) {
    if (allowMissingLedger) return [];
    throw new Error("migration ledger unavailable: fincoach_schema_migrations is missing");
  }
  const rows = await client.query("SELECT migration_id, filename, checksum, status, started_at, applied_at, error_message FROM fincoach_schema_migrations ORDER BY migration_id");
  return rows.rows as Array<{ migration_id: string; filename: string; checksum: string; status: "running" | "applied"; started_at: Date; applied_at: Date | null; error_message: string | null }>;
}

async function printStatus(state: Awaited<ReturnType<typeof readState>>) {
  const applied = new Map(state.map((row) => [row.migration_id, row]));
  const pending = migrations.filter((migration) => !applied.has(migration.id));
  const partial = state.filter((row) => row.status !== "applied");
  const mismatched = migrations.filter((migration) => applied.get(migration.id)?.checksum && applied.get(migration.id)?.checksum !== migration.checksum);
  console.log(JSON.stringify({
    database: redactDatabaseUrl(databaseUrl!),
    schemaVersion: state.filter((row) => row.status === "applied").at(-1)?.migration_id ?? null,
    migrationTable: "fincoach_schema_migrations",
    totalTrackedMigrations: migrations.length,
    applied: state.filter((row) => row.status === "applied").length,
    pending: pending.map((migration) => migration.id),
    partial: partial.map((row) => row.migration_id),
    checksumMismatches: mismatched.map((migration) => migration.id),
    ok: pending.length === 0 && partial.length === 0 && mismatched.length === 0,
  }, null, 2));
}

async function verify(state: Awaited<ReturnType<typeof readState>>) {
  const applied = new Map(state.map((row) => [row.migration_id, row]));
  const pending = migrations.filter((migration) => !applied.has(migration.id));
  const partial = state.filter((row) => row.status !== "applied");
  const mismatched = migrations.filter((migration) => applied.get(migration.id)?.checksum && applied.get(migration.id)?.checksum !== migration.checksum);
  if (partial.length) throw new Error(`partial migration detected: ${partial.map((row) => row.migration_id).join(", ")}`);
  if (mismatched.length) throw new Error(`migration checksum mismatch: ${mismatched.map((migration) => migration.id).join(", ")}`);
  if (pending.length) throw new Error(`pending migrations: ${pending.map((migration) => migration.id).join(", ")}`);
  console.log("db_migration_verify_ok");
}

async function migrate(state: Awaited<ReturnType<typeof readState>>) {
  const releaseLock = await acquireMigrationLock();
  try {
  const applied = new Map(state.map((row) => [row.migration_id, row]));
  const partial = state.filter((row) => row.status !== "applied");
  if (partial.length) throw new Error(`partial migration detected; inspect before retry: ${partial.map((row) => row.migration_id).join(", ")}`);
  for (const migration of migrations) {
    const existing = applied.get(migration.id);
    if (existing?.checksum && existing.checksum !== migration.checksum) throw new Error(`migration checksum mismatch: ${migration.id}`);
    if (existing) continue;
    if (args.includes("--dry-run") || args.includes("--plan")) {
      console.log(`pending ${migration.id} ${migration.checksum}`);
      continue;
    }
    await applyMigration(migration);
  }
  if (args.includes("--dry-run") || args.includes("--plan")) return;
  await verify(await readState());
  } finally {
    await releaseLock();
  }
}

async function printAssessment() {
  const assessments = await assessMigrations(client, migrations);
  const summary = assessments.reduce<Record<string, number>>((acc, item) => {
    acc[item.state] = (acc[item.state] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    database: redactDatabaseUrl(databaseUrl!),
    checkedAt: new Date().toISOString(),
    totalTrackedMigrations: migrations.length,
    summary,
    migrations: assessments,
    okForBaselineAllEquivalent: assessments.every((item) => item.state === "schema_equivalent_without_ledger" || item.state === "applied_and_recorded"),
  }, null, 2));
}

async function baselineEquivalentMigrations() {
  const dryRun = args.includes("--dry-run") || args.includes("--plan");
  const allEquivalent = args.includes("--all-equivalent");
  const requested = new Set(valuesAfter("--migration"));
  if (!allEquivalent && requested.size === 0) throw new Error("baseline requires --all-equivalent or one or more --migration <id>");
  const backup = valueAfter("--backup") ?? process.env.FINCOACH_DB_BACKUP_PATH;
  const checksum = valueAfter("--checksum") ?? process.env.FINCOACH_DB_BACKUP_SHA256_PATH;
  if (!backup) throw new Error("baseline backup gate failed: --backup or FINCOACH_DB_BACKUP_PATH is required");
  const backupEvidence = verifyBackupArtifact({ backupPath: backup, checksumPath: checksum, requireOutsideRepository: true, mustPredate: new Date() });
  const releaseLock = await acquireMigrationLock();
  try {
    const assessments = await assessMigrations(client, migrations);
    const selected = assessments.filter((item) => allEquivalent ? item.state === "schema_equivalent_without_ledger" : requested.has(item.migrationId));
    if (!selected.length && allEquivalent && assessments.every((item) => item.state === "applied_and_recorded")) {
      console.log(JSON.stringify({
        dryRun,
        applied: false,
        idempotent: true,
        database: redactDatabaseUrl(databaseUrl!),
        backupEvidence,
        repositoryCommit: currentCommit(),
        baselineMigrations: [],
        checkedAt: new Date().toISOString(),
      }, null, 2));
      return;
    }
    if (!selected.length) throw new Error("no baselineable migrations selected");
    const unsafe = selected.filter((item) => item.state !== "schema_equivalent_without_ledger");
    if (unsafe.length) throw new Error(`baseline rejected non-equivalent migrations: ${unsafe.map((item) => `${item.migrationId}:${item.state}`).join(", ")}`);
    if (allEquivalent) {
      const blockers = assessments.filter((item) => !["schema_equivalent_without_ledger", "applied_and_recorded"].includes(item.state));
      if (blockers.length) throw new Error(`baseline --all-equivalent rejected blockers: ${blockers.map((item) => `${item.migrationId}:${item.state}`).join(", ")}`);
    }
    const result = {
      dryRun,
      database: redactDatabaseUrl(databaseUrl!),
      backupEvidence,
      repositoryCommit: currentCommit(),
      baselineMigrations: selected.map((item) => ({ migrationId: item.migrationId, checksum: item.checksum, evidence: item.evidence })),
      checkedAt: new Date().toISOString(),
    };
    if (dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    await client.query("BEGIN");
    await ensureLedger();
    await client.query(`
      CREATE TABLE IF NOT EXISTS fincoach_schema_migration_baselines (
        baseline_id text PRIMARY KEY,
        migration_id text NOT NULL,
        checksum text NOT NULL,
        repository_commit text,
        backup_path text NOT NULL,
        backup_checksum text NOT NULL,
        evidence jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        operator_context text
      )
    `);
    for (const item of selected) {
      await client.query(`
        INSERT INTO fincoach_schema_migrations (migration_id, filename, checksum, status, started_at, applied_at, execution_ms, error_message)
        VALUES ($1, $2, $3, 'applied', now(), now(), 0, NULL)
        ON CONFLICT (migration_id) DO UPDATE SET checksum = EXCLUDED.checksum
        WHERE fincoach_schema_migrations.checksum = EXCLUDED.checksum
      `, [item.migrationId, item.filename, item.checksum]);
      await client.query(`
        INSERT INTO fincoach_schema_migration_baselines (baseline_id, migration_id, checksum, repository_commit, backup_path, backup_checksum, evidence, operator_context)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (baseline_id) DO NOTHING
      `, [`${item.migrationId}:${item.checksum}`, item.migrationId, item.checksum, currentCommit(), backupEvidence.path, backupEvidence.checksum, JSON.stringify(item.evidence), process.env.USER ?? "unknown"]);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ ...result, applied: true }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await releaseLock();
  }
}

async function applyMigration(migration: MigrationFile) {
  const started = Date.now();
  await client.query("INSERT INTO fincoach_schema_migrations (migration_id, filename, checksum, status) VALUES ($1, $2, $3, 'running')", [migration.id, migration.filename, migration.checksum]);
  try {
    if (hasExplicitTransaction(migration.sql)) {
      await client.query(migration.sql);
    } else {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query("COMMIT");
    }
    await client.query("UPDATE fincoach_schema_migrations SET status = 'applied', applied_at = now(), execution_ms = $2, error_message = NULL WHERE migration_id = $1", [migration.id, Date.now() - started]);
    console.log(`applied ${migration.id}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("UPDATE fincoach_schema_migrations SET error_message = $2 WHERE migration_id = $1", [migration.id, error instanceof Error ? error.message : String(error)]).catch(() => undefined);
    throw error;
  }
}

async function acquireMigrationLock() {
  const lockKey = 784_202_615;
  const timeoutMs = Number(process.env.FINCOACH_DB_MIGRATION_LOCK_TIMEOUT_MS ?? "0");
  const started = Date.now();
  do {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [lockKey]);
    if (result.rows[0]?.locked === true) {
      process.stderr.write(`${JSON.stringify({ event: "fincoach_migration_lock_acquired", lockKey, policy: { timeoutMs } })}\n`);
      return async () => {
        await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
        process.stderr.write(`${JSON.stringify({ event: "fincoach_migration_lock_released", lockKey })}\n`);
      };
    }
    if (Date.now() - started >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, timeoutMs)));
  } while (true);
  throw new Error(`migration advisory lock unavailable after ${timeoutMs}ms`);
}

async function runBackup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const backupDirectory = process.env.FINCOACH_DB_BACKUP_DIR ?? "/tmp/fincoach-db-backups";
  mkdirSync(backupDirectory, { recursive: true });
  const backupId = new Date().toISOString().replace(/[:.]/g, "-");
  const output = `${backupDirectory}/fincoach-${backupId}.dump`;
  const tempOutput = `${output}.tmp-${process.pid}`;
  if (existsSync(output)) throw new Error(`backup already exists: ${output}`);
  const backupClient = new Client({ connectionString: url });
  await backupClient.connect();
  let identity: Record<string, unknown> = {};
  let toolSelection: Awaited<ReturnType<typeof resolvePostgresTools>>;
  try {
    identity = (await backupClient.query(`
      SELECT current_database() AS database, current_user AS "user", version() AS postgres_version,
        current_setting('server_version_num')::int AS server_version_num,
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = current_schema()) AS table_count
    `)).rows[0] ?? {};
    toolSelection = await resolvePostgresTools(url, async () => Number(identity.server_version_num));
  } finally {
    await backupClient.end();
  }
  try {
    runPgDumpToFile(toolSelection!, url, tempOutput);
    if (!existsSync(tempOutput) || statSync(tempOutput).size <= 0) throw new Error("pg_dump produced an empty backup");
    pgRestoreListWithPolicy(tempOutput, toolSelection!);
    renameSync(tempOutput, output);
    const checksum = sha256File(output);
    const checksumPath = `${output}.sha256`;
    writeFileSync(checksumPath, `${checksum}  ${output}\n`);
    const metadata = {
      backupId,
      path: output,
      checksum,
      checksumPath,
      databaseIdentity: { ...identity, url: redactDatabaseUrl(url) },
      postgresVersion: identity.postgres_version ?? null,
      postgresClient: toolSelection!,
      repositoryCommit: currentCommit(),
      createdAt: new Date().toISOString(),
      sizeBytes: statSync(output).size,
      schemaTableCounts: { currentSchemaTables: identity.table_count ?? null },
    };
    writeFileSync(`${output}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    const evidence = verifyBackupArtifact({ backupPath: output, checksumPath, requireOutsideRepository: true });
    console.log(JSON.stringify({ ...metadata, verification: evidence }, null, 2));
  } catch (error) {
    if (existsSync(tempOutput)) unlinkSync(tempOutput);
    throw error;
  }
}

async function runRestoreVerify() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const backupPath = valueAfter("--backup");
  if (!backupPath) throw new Error("--backup is required");
  const checksumPath = valueAfter("--checksum") ?? process.env.FINCOACH_DB_BACKUP_SHA256_PATH;
  const evidence = verifyBackupArtifact({ backupPath, checksumPath, requireOutsideRepository: false });
  const source = new URL(url);
  const originalDatabase = source.pathname.replace(/^\//, "");
  const tempDatabase = `fincoach_restore_verify_${Date.now()}_${process.pid}`.toLowerCase();
  if (!/^fincoach_restore_verify_[a-z0-9_]+$/.test(tempDatabase)) throw new Error("invalid temporary restore database name");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const tempUrl = new URL(url);
  tempUrl.pathname = `/${tempDatabase}`;
  const keepOnFailure = args.includes("--keep-temp-on-failure");
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  let created = false;
  try {
    const versionRow = await admin.query("SELECT current_setting('server_version_num')::int AS server_version_num");
    const toolSelection = await resolvePostgresTools(url, async () => Number(versionRow.rows[0].server_version_num));
    if (originalDatabase === tempDatabase) throw new Error("restore verification refused to target configured database");
    await admin.query(`CREATE DATABASE ${quoteIdent(tempDatabase)}`);
    created = true;
    runPgRestoreToDatabase(toolSelection, tempUrl.toString(), evidence.path);
    const restored = new Client({ connectionString: tempUrl.toString() });
    await restored.connect();
    try {
      const tables = (await restored.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")).rows.map((row) => row.tablename);
      const ledger = tables.includes("fincoach_schema_migrations")
        ? (await restored.query("SELECT migration_id, checksum, status FROM fincoach_schema_migrations ORDER BY migration_id")).rows
        : [];
      const required = ["fincoach_schema_migrations"];
      const missing = required.filter((table) => !tables.includes(table));
      const partial = ledger.filter((row: { status: string }) => row.status !== "applied").map((row: { migration_id: string }) => row.migration_id);
      if (missing.length) throw new Error(`restore verification missing required tables: ${missing.join(", ")}`);
      if (partial.length) throw new Error(`restore verification found partial migrations: ${partial.join(", ")}`);
      console.log(JSON.stringify({
        verdict: "restore_verified",
        backup: evidence,
        sourceDatabase: redactDatabaseUrl(url),
        temporaryDatabase: tempDatabase,
        restoredTableCount: tables.length,
        migrationLedgerRows: ledger.length,
        checkedAt: new Date().toISOString(),
      }, null, 2));
    } finally {
      await restored.end();
    }
    await admin.query(`DROP DATABASE ${quoteIdent(tempDatabase)} WITH (FORCE)`);
    created = false;
  } catch (error) {
    if (created && !keepOnFailure) {
      await admin.query(`DROP DATABASE ${quoteIdent(tempDatabase)} WITH (FORCE)`).catch(() => undefined);
    } else if (created) {
      process.stderr.write(`${JSON.stringify({ event: "fincoach_restore_verify_temp_preserved", temporaryDatabase: tempDatabase })}\n`);
    }
    throw error;
  } finally {
    await admin.end();
  }
}

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function valuesAfter(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function hasExplicitTransaction(sql: string) {
  return /^\s*BEGIN\s*;/i.test(sql) && /COMMIT\s*;\s*$/i.test(sql);
}
