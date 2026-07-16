import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { assertDisposableLocalDatabase, verifyBackupArtifact } from "./dbLifecycle";

export type MigrationFile = {
  id: string;
  filename: string;
  path: string;
  sql: string;
  checksum: string;
};

export type DestructiveDdlFinding = {
  migrationId: string;
  statement: string;
  reason: string;
};

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bdrop\s+table\b/i, reason: "DROP TABLE is destructive" },
  { pattern: /\bdrop\s+column\b/i, reason: "DROP COLUMN is destructive" },
  { pattern: /\btruncate\s+table\b/i, reason: "TRUNCATE TABLE is destructive" },
  { pattern: /\bdelete\s+from\b/i, reason: "DELETE FROM may remove existing data" },
  { pattern: /\balter\s+table\b[\s\S]*\bdrop\s+constraint\b/i, reason: "DROP CONSTRAINT can weaken existing data guarantees" },
  { pattern: /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/i, reason: "SET NOT NULL can fail or rewrite populated data without a backfill gate" },
];

export function loadMigrationFiles(migrationsDirectory = "migrations"): MigrationFile[] {
  return readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const path = join(migrationsDirectory, filename);
      const sql = readFileSync(path, "utf8");
      return {
        id: basename(filename, ".sql"),
        filename,
        path,
        sql,
        checksum: sha256(sql),
      };
    });
}

export function findDestructiveDdl(migrations: MigrationFile[]): DestructiveDdlFinding[] {
  const findings: DestructiveDdlFinding[] = [];
  for (const migration of migrations) {
    for (const statement of splitSqlStatements(stripSqlComments(migration.sql))) {
      for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(statement)) findings.push({ migrationId: migration.id, statement: statement.trim().replace(/\s+/g, " "), reason });
      }
    }
  }
  return findings;
}

export function requireBackupGate(args: string[], env: NodeJS.ProcessEnv) {
  if (args.includes("--dry-run") || args.includes("--plan")) return;
  if (env.FINCOACH_ALLOW_DISPOSABLE_DB_MIGRATION_WITHOUT_BACKUP === "true") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for disposable backup bypass");
    assertDisposableLocalDatabase(env.DATABASE_URL);
    return;
  }
  const backupPath = env.FINCOACH_DB_BACKUP_PATH?.trim();
  if (!backupPath) throw new Error("backup gate failed: FINCOACH_DB_BACKUP_PATH is required");
  const evidence = verifyBackupArtifact({
    backupPath,
    checksumPath: env.FINCOACH_DB_BACKUP_SHA256_PATH,
    maxAgeHours: Number(env.FINCOACH_DB_BACKUP_MAX_AGE_HOURS ?? "24"),
    mustPredate: new Date(),
  });
  process.stderr.write(`${JSON.stringify({ event: "fincoach_backup_gate_verified", evidence })}\n`);
}

export function redactDatabaseUrl(input: string) {
  const url = new URL(input);
  if (url.password) url.password = "REDACTED";
  if (url.username) url.username = "REDACTED";
  return url.toString();
}

function splitSqlStatements(sql: string) {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

function stripSqlComments(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
