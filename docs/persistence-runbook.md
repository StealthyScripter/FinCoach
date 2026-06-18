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

Use one of these approaches:

```bash
npm run db:push
```

or apply the versioned SQL migration directly:

```bash
psql "$DATABASE_URL" -f migrations/0001_marketpilot_core.sql
```

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
- Apply migrations in a transaction where the target PostgreSQL environment supports transactional DDL.
- Do not drop columns or tables in forward migrations without first deploying code that no longer reads them.
- Add additive columns as nullable or with safe defaults, backfill, then enforce stricter constraints in a later migration.
- Keep demo seeding idempotent so repeated health checks or restarts do not duplicate baseline records.

## v2.0 Adapter Persistence Notes

The v2.0 infrastructure layer introduces persistence-ready contracts without forcing external services in development:

- `EventLogStore` has an in-memory implementation and a PostgreSQL-ready adapter stub. A future migration should add an append-only `marketpilot_events` table with event ID, type, version, user ID, correlation ID, causation ID, source service, payload JSONB, payload hash, and created timestamp.
- `TimeSeriesStore` supports price bars, economic observations, options snapshots, and ingestion run metadata. A future Timescale migration should split these into hypertables keyed by symbol/series/underlying and timestamp.
- `VectorStore` keeps semantic records in memory today. A future Qdrant migration should persist vector IDs that reference PostgreSQL source documents instead of duplicating regulated content.
- `CacheStore` remains non-authoritative. Redis may back rate limits, session memory, provider response cache, and supervisor state cache, but durable decisions must still be written to PostgreSQL/audit/event storage.

Rollback guidance:

- Keep new adapter migrations additive.
- Deploy code that can read both in-memory/demo and external adapter health states before switching traffic.
- For time-series and vector data, rollback can disable the adapter env flag and fall back to demo memory mode without changing user-facing safety gates.
