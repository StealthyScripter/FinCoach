# V2 Production Migration Policy

Production and cloud schema changes must use:

```bash
export FINCOACH_DB_BACKUP_PATH=/var/backups/fincoach/fincoach-<timestamp>.dump
export FINCOACH_DB_BACKUP_SHA256_PATH=/var/backups/fincoach/fincoach-<timestamp>.dump.sha256

npm run db:restore:verify -- --backup "$FINCOACH_DB_BACKUP_PATH" --checksum "$FINCOACH_DB_BACKUP_SHA256_PATH"
npm run db:migrate:assess
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:verify
```

The migration runner applies tracked `migrations/*.sql` files in filename order, records checksums in `fincoach_schema_migrations`, rejects checksum mismatches and partial `running` rows, wraps migrations atomically unless the SQL file has an explicit transaction, and uses a deterministic PostgreSQL advisory lock for execution. `status` and `verify` are read-only and do not acquire the execution lock.

If an existing database already has structurally equivalent schema objects but lacks ledger rows, operators must use the read-only assessment first. Only migrations reported as `schema_equivalent_without_ledger` may be baselined:

```bash
npm run db:migrate:baseline -- \
  --all-equivalent \
  --backup "$FINCOACH_DB_BACKUP_PATH" \
  --checksum "$FINCOACH_DB_BACKUP_SHA256_PATH"
```

Baselining records ledger and baseline-audit rows only. It does not rerun migration SQL and must fail closed for partial, incompatible, ambiguous, or checksum-mismatched migrations.

The migration backup gate requires a real backup path, SHA-256 checksum, readable custom-format archive catalog, maximum age check, and backup timestamp before migration execution. Disposable local test databases may bypass this only with `FINCOACH_ALLOW_DISPOSABLE_DB_MIGRATION_WITHOUT_BACKUP=true`.

PostgreSQL client tooling is version checked. `FINCOACH_PG_DUMP_BIN` and `FINCOACH_PG_RESTORE_BIN` may point to explicit matching binaries. If unset, FinCoach can use `FINCOACH_POSTGRES_CONTAINER` or a detected healthy PostgreSQL Docker container so `pg_dump` and `pg_restore` match the server major version. Older host clients are rejected.

`npm run db:push` is local-disposable tooling only. It requires `FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH=true`, a recognized local disposable database URL, and `--i-understand-this-destroys-disposable-local-state`. This guard covers supported FinCoach commands, but it cannot technically prevent direct manual invocation of `npx drizzle-kit push`; production policy prohibits that command.
