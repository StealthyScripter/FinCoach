# V2 Migration Recovery

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
