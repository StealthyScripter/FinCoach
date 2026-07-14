# V2 PostgreSQL Schema Policy

V2 PostgreSQL persistence must be module-owned. Tables must not become shared miscellaneous state.

Required table properties:

- schema version field;
- natural key or unique idempotency key;
- `created_at`;
- `updated_at` only for explicitly mutable operational state;
- correlation ID;
- causation ID where applicable;
- source module;
- JSON payload validation at repository boundaries;
- transaction boundary for every durable write;
- explicit conflict behavior.

Immutable domain evidence is append-only. Operational state such as leases, checkpoints, retry state, pilot state, and delivery state may update only through explicit transactional policies.

Unknown SQL errors fail closed. Arbitrary SQL errors must never be treated as duplicate conflicts. A checkpoint, lease, delivery, acknowledgement, or scorecard update is not successful until its transaction commits.

Migrations must be deterministic, ordered, safe to reapply, indexed for expected query patterns, and compatible with existing seeded data. Existing production or seeded data must not be deleted or rewritten.

## Milestone B Operational Schema

`migrations/0014_v2_operational_persistence.sql` introduces durable operational tables required before an extended demo pilot.

Ownership and retention follow `docs/v2-persistence-ownership-map.md`. No table is shared as miscellaneous V2 state.

Conflict policy:

- Unique idempotency keys define exact duplicate detection.
- Natural-key uniqueness protects recovery reads and duplicate-cycle, duplicate-checkpoint, duplicate-dead-letter, duplicate-scorecard, and duplicate-report prevention.
- Exact duplicates return an idempotent result.
- Conflicting duplicates return an explicit conflict result or typed persistence error.
- Unknown SQL failures remain `unknown_persistence_failure` and fail closed.

Mutable operational fields:

- checkpoints may advance only to the same or higher attempt;
- retries may advance only monotonically;
- leases may update only through acquisition, renewal, release, or stale recovery with fencing-token checks;
- pilot lifecycle state changes require the expected previous state;
- daily report delivery status is append-style by attempt and cannot silently overwrite failed delivery evidence.

Repository payload validation rejects unsupported schema versions and malformed persisted JSON before returning records to callers.
