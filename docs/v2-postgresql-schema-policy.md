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
