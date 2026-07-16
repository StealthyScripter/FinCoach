# V2 Database Backup Verification

`npm run db:backup` creates a PostgreSQL custom-format backup with `pg_dump --format=custom`, writes to a temporary file first, validates the archive catalog with `pg_restore --list`, writes a SHA-256 file, and emits metadata with the redacted database identity, repository commit, size, timestamp, and table count.

Backup uses version-safe PostgreSQL tooling. Operators may set `FINCOACH_PG_DUMP_BIN` and `FINCOACH_PG_RESTORE_BIN`, or `FINCOACH_POSTGRES_CONTAINER` to run `pg_dump`/`pg_restore` inside a matching PostgreSQL Docker container. A client older than the server is rejected.

Backups must be stored outside the repository working tree:

```bash
FINCOACH_DB_BACKUP_DIR=/var/backups/fincoach npm run db:backup
```

Before migration or cloud replay, verify the artifact with an isolated restore:

```bash
npm run db:restore:verify -- \
  --backup /var/backups/fincoach/fincoach-<timestamp>.dump \
  --checksum /var/backups/fincoach/fincoach-<timestamp>.dump.sha256
```

Restore verification checks the checksum, archive catalog, creates a unique temporary database, restores with `--no-owner --no-privileges`, inspects restored tables and the migration ledger, drops the temporary database on success, and returns nonzero on checksum, archive, restore, missing-table, or partial-migration failures.

Use `--keep-temp-on-failure` only during an incident investigation when the failed temporary database must be preserved for inspection.
