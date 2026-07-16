# V2 Migration Recovery And Incident Assessment

## Production Migration Command

Production and cloud deployment must use tracked SQL migrations, not schema push:

```bash
set -a
source .env
set +a

npm run db:backup
export FINCOACH_DB_BACKUP_PATH=<absolute-backup-dump-outside-repo>
export FINCOACH_DB_BACKUP_SHA256_PATH=<absolute-backup-sha256>
npm run db:restore:verify -- --backup "$FINCOACH_DB_BACKUP_PATH" --checksum "$FINCOACH_DB_BACKUP_SHA256_PATH"
npm run db:migrate:assess
npm run db:migrate
npm run db:migrate:status
npm run db:migrate:verify
```

`npm run db:migrate` applies `migrations/*.sql` in filename order, records every applied migration in `fincoach_schema_migrations`, verifies checksums, fails if a previous migration is still marked `running`, and rejects destructive DDL unless `FINCOACH_DB_BREAK_GLASS_DESTRUCTIVE_DDL=true` is set through a separate incident-approved break-glass process.

`npm run db:migrate:assess` is read-only. It classifies each migration as `unapplied`, `schema_equivalent_without_ledger`, `partially_present`, `incompatible`, `applied_and_recorded`, or `checksum_mismatch`. Baselining is allowed only for structurally equivalent migrations and must use a verified backup:

```bash
npm run db:migrate:baseline -- --all-equivalent --backup "$FINCOACH_DB_BACKUP_PATH" --checksum "$FINCOACH_DB_BACKUP_SHA256_PATH"
```

`npm run db:push` is disabled by default and is only allowed for disposable local development with `FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH=true`, a local/disposable database URL, and the typed confirmation argument. This guard covers supported repository commands; it cannot technically prevent a manual `npx drizzle-kit push`, which is prohibited by production policy.

## Read-Only Incident Assessment

After the destructive schema-push incident, run the read-only assessment before any restoration:

```bash
set -a
source .env
set +a

npm run db:incident:assess > artifacts/db-incident-assessment.json
```

The report includes the current database identity with credentials redacted, required table presence, row counts, migration state, schema version, index names, constraint names, missing tables, and suspiciously empty formerly populated tables.

## Temporary Restore And Compare

Do not restore over production directly. Restore a backup into a temporary database, assess it, and compare table counts first:

```bash
npm run db:restore:verify -- --backup <backup.dump> --checksum <backup.dump.sha256>
DATABASE_URL=<TEMP_RESTORE_DATABASE_URL> npm run db:incident:assess > artifacts/db-restore-assessment.json
DATABASE_URL=<PRODUCTION_DATABASE_URL> npm run db:incident:assess > artifacts/db-production-assessment.json
```

Compare the assessment files for the incident tables before planning production restoration. Restoration is a manual operator action and must preserve any post-backup records that still exist in production.

V2 operational persistence is introduced by `migrations/0014_v2_operational_persistence.sql`.

Migration requirements:

- Migration execution must be wrapped in `BEGIN`/`COMMIT`.
- Tables are module-owned: `v2_orchestration_*`, `v2_pilot_*`, and `v2_operations_*`.
- Natural and idempotency keys are enforced by primary keys, unique constraints, or unique indexes.
- Worker leases use a fencing token and expiration indexes.
- Daily report delivery prevents duplicate delivered state per report and destination.
- Existing production or seeded data must not be deleted or rewritten during migration.

Recovery behavior:

- Missing V2 operational tables or columns are classified as `migration_mismatch`.
- Unsupported persisted schema versions are classified as `unsupported_schema_version`.
- Malformed JSON payloads are classified as `malformed_persisted_record`.
- Unknown PostgreSQL failures remain typed persistence failures and fail closed.
- Corrective migration strategy is additive: create missing module-owned objects, add indexes concurrently only when needed by a later operational migration, and preserve existing rows.

Rollback strategy:

- Do not roll back by deleting V2 evidence tables after pilot data exists.
- If a migration partially applies before commit, re-run the idempotent migration after correcting the database fault.
- If a schema version is unsupported, stop V2 operations, preserve the offending row, and apply a corrective migration or reader compatibility update.
- If malformed rows are found, quarantine by primary key in an operator incident record before any manual correction.

Validation coverage:

- `server/schemaMigration.test.ts` checks deterministic table/index presence for migration `0014`.
- `server/v2.restart-recovery.pg.test.ts` checks migration mismatch, unsupported schema version, malformed payload handling, and restart recovery against the migrated schema.
