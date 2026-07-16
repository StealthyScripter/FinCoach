import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { findDestructiveDdl, loadMigrationFiles, redactDatabaseUrl, requireBackupGate } from "../scripts/db/migrationSafety";

const root = "/tmp/fincoach-db-migration-safety-test";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "0001_additive.sql"), "CREATE TABLE IF NOT EXISTS sample (id text PRIMARY KEY);\n");
writeFileSync(join(root, "0002_drop.sql"), "ALTER TABLE sample DROP COLUMN old_value;\n");

const migrations = loadMigrationFiles(root);
assert.deepEqual(migrations.map((migration) => migration.id), ["0001_additive", "0002_drop"]);
assert.equal(migrations[0].checksum.length, 64);
assert.match(findDestructiveDdl(migrations)[0].reason, /DROP COLUMN/);
assert.equal(redactDatabaseUrl("postgres://user:secret@localhost:5432/db"), "postgres://REDACTED:REDACTED@localhost:5432/db");
assert.throws(() => requireBackupGate([], {}), /backup gate failed/);
assert.doesNotThrow(() => requireBackupGate(["--dry-run"], {}));
assert.doesNotThrow(() => requireBackupGate([], {
  FINCOACH_ALLOW_DISPOSABLE_DB_MIGRATION_WITHOUT_BACKUP: "true",
  DATABASE_URL: "postgres://user:secret@localhost:5432/fincoach_test",
}));
assert.throws(() => requireBackupGate(["--backup-confirmed"], { FINCOACH_DB_BACKUP_ID: "backup-1" }), /FINCOACH_DB_BACKUP_PATH/);

console.log("db migration safety tests passed");
