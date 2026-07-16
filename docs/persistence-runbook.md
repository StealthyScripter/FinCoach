# MarketPilot Persistence Runbook

## Current Mode

The app boots with in-memory seed data when `DATABASE_URL` is absent. When `DATABASE_URL` is present, `createStorage()` selects the PostgreSQL-backed `PgStorage` adapter unless `MARKETPILOT_STORAGE=memory` is set.

The MarketPilot core schema is represented in two places:

- Drizzle table definitions in `shared/schema.ts`
- Initial SQL migration in `migrations/0001_marketpilot_core.sql`

## Required Environment

Set `DATABASE_URL` before running database commands:

```bash
export DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE
```

Optional local override:

```bash
export MARKETPILOT_STORAGE=memory
```

Use this override when a database URL exists in the shell but you want the local seeded in-memory mode.

## Apply Schema

Production and shared databases must use the tracked migration runner:

```bash
npm run db:backup
export FINCOACH_DB_BACKUP_PATH=/outside/repo/fincoach-<timestamp>.dump
export FINCOACH_DB_BACKUP_SHA256_PATH=/outside/repo/fincoach-<timestamp>.dump.sha256
npm run db:restore:verify -- --backup "$FINCOACH_DB_BACKUP_PATH" --checksum "$FINCOACH_DB_BACKUP_SHA256_PATH"
npm run db:migrate
npm run db:migrate:verify
```

For inspection without applying changes:

```bash
npm run db:migrate -- --dry-run
npm run db:migrate:status
```

`npm run db:push` is guarded repository tooling only. It still cannot prevent a developer from invoking `npx drizzle-kit push` manually, so production policy and deployment scripts prohibit direct schema push.

## Implemented Adapter Coverage

`PgStorage` now maps:

- Learning/proficiency reads to `learning_modules` and `proficiency_scores`
- Research and verification reads to `research_reports` and `verification_checks`
- Paper portfolio reads to `paper_portfolios` and `holdings`
- Ticket creation/fill workflow to `trade_tickets`, `risk_checks`, `verification_checks`, `journal_entries`, and `audit_logs`

The paper-fill invariant must remain unchanged: only risk-approved `proposed` tickets may become `paper_filled`.

## Next Persistence Step

Add integration tests against a real PostgreSQL instance and promote `PgStorage` from adapter-ready to production-ready. Those tests should apply `migrations/0001_marketpilot_core.sql`, boot the API with `DATABASE_URL`, create a paper ticket, paper-fill an approved ticket, and assert rows were persisted across process restarts.

## v1.0 Readiness Additions

- `DATABASE_URL` is now syntactically validated before PostgreSQL storage is selected.
- `MARKETPILOT_STORAGE=memory` forces demo memory mode even when `DATABASE_URL` is present.
- `/api/health/storage` reports selected mode, migration version, seed strategy, and readiness checks.
- PostgreSQL tests continue to skip clearly when `DATABASE_URL` is not set; memory-mode smoke tests must still pass.

## Migration Safety Notes

- Treat `migrations/0001_marketpilot_core.sql` as the baseline migration for the current MVP schema.
- `migrations/0002_execution_reliability.sql` adds transactional idempotency reservations, expiring strategy leases, and immutable reconciliation reports for multi-instance execution workers.
- `migrations/0003_execution_governance.sql` adds row-locked semi-autonomous approvals, append-only MarketPilot events and execution audit entries, and append-only audit export metadata.
- Apply migrations in a transaction where the target PostgreSQL environment supports transactional DDL.
- Do not drop columns or tables in forward migrations without first deploying code that no longer reads them.
- Add additive columns as nullable or with safe defaults, backfill, then enforce stricter constraints in a later migration.
- Keep demo seeding idempotent so repeated health checks or restarts do not duplicate baseline records.

## v2.0 Adapter Persistence Notes

The v2.0 infrastructure layer introduces persistence-ready contracts without forcing external services in development:

- `EventLogStore` has an in-memory implementation and a PostgreSQL-backed adapter. The append-only `marketpilot_events` table stores event ID, type, version, user ID, correlation ID, causation ID, source service, payload JSONB, payload hash, and created timestamp.
- `MemoryStore` now persists long-term and semantic memory records to a `memory_records` table in PostgreSQL when `DATABASE_URL` is present, while still allowing in-memory development mode.
- Knowledge-graph, institutional-analytics, and model-validation snapshots are archived as append-only event log entries so replay tooling can recover prior analytical evidence.
- `TimeSeriesStore` supports price bars, economic observations, options snapshots, and ingestion run metadata. A future Timescale migration should split these into hypertables keyed by symbol/series/underlying and timestamp.
- `VectorStore` now persists semantic records to PostgreSQL when `DATABASE_URL` is present, using the same similarity contract as the in-memory implementation. Qdrant remains the future networked vector service.
- `CacheStore` remains non-authoritative. Redis may back rate limits, session memory, provider response cache, and supervisor state cache, but durable decisions must still be written to PostgreSQL/audit/event storage.

Rollback guidance:

- Keep new adapter migrations additive.
- Deploy code that can read both in-memory/demo and external adapter health states before switching traffic.
- For time-series and vector data, rollback can disable the adapter env flag and fall back to demo memory mode without changing user-facing safety gates.

## Execution reliability storage

When `DATABASE_URL` is configured, MarketPilot uses PostgreSQL transactions and row locks to arbitrate sandbox submission keys and strategy ownership across processes. Completed submission results are replayable, conflicting fingerprints are rejected, concurrent unknown outcomes become `in_doubt`, and only the reservation owner can complete or abandon an active reservation.

Strategy acquisition uses `SELECT ... FOR UPDATE` and an expiry check before upsert. Lease renewal and release require the same owner ID. Reconciliation reports are appended to PostgreSQL while retaining local event and audit evidence.

Without `DATABASE_URL`, the transactional coordinator uses an in-memory implementation. `MARKETPILOT_RELIABILITY_STATE_FILE` may additionally provide single-process restart durability, but it is not a substitute for PostgreSQL coordination in multi-instance deployments.

## Governance and audit export

When PostgreSQL is configured, global MarketPilot events and execution audit entries are appended to `marketpilot_events` and `execution_audit_entries`. Audit generation waits for pending writes, merges durable and current-process records by ID, sorts them chronologically, and then constructs independent hash chains.

Set:

```bash
export MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY='use-a-secret-manager-value'
export MARKETPILOT_AUDIT_EXPORT_DIR='/secure/external-audit-exports'
export MARKETPILOT_AUDIT_ARCHIVE_DIR='/secure/archive-mirror'
```

Artifacts are written atomically with mode `0600`. Each export links to the prior artifact digest and is HMAC-SHA256 signed when the key is configured. When the archive mirror is configured, the artifact is written to both directories so the export can still be recovered if the primary path is lost. Level 6 requires PostgreSQL governance persistence, signing, and an external export directory.
The operator UI can request a fresh export and retrieve an existing export by ID to re-run digest, signature, event-chain, and execution-audit verification against the stored artifact file.
