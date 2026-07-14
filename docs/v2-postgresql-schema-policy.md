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

`migrations/0015_v2_evidence_persistence.sql` introduces module-owned append-only evidence tables for the high-priority V2 research evidence repositories. The tables share a persistence shape for idempotency, schema versioning, lineage, correlation, causation, payload immutability, and supersession references, but ownership remains per module and table.

Ownership and retention follow `docs/v2-persistence-ownership-map.md`. No table is shared as miscellaneous V2 state.

Conflict policy:

- Unique idempotency keys define exact duplicate detection.
- Natural-key uniqueness protects recovery reads and duplicate-cycle, duplicate-checkpoint, duplicate-dead-letter, duplicate-scorecard, and duplicate-report prevention.
- Exact duplicates return an idempotent result.
- Conflicting duplicates return an explicit conflict result or typed persistence error.
- Unknown SQL failures remain `unknown_persistence_failure` and fail closed.

## Evidence Tables

Evidence tables added in V2.1:

- `v2_forward_tests`
- `v2_research_signals`
- `v2_external_evaluations`
- `v2_research_journal_entries`
- `v2_learning_lessons`
- `v2_learning_revision_proposals`
- `v2_strategy_revision_proposals`
- `v2_strategy_lifecycle_decisions`
- `v2_court_verdicts`
- `v2_ranking_decisions`

Each table has:

- `record_id` primary key;
- `natural_key` unique;
- `idempotency_key` unique;
- `schema_version`;
- `source_module`;
- immutable `payload`;
- `lineage_event_ids`;
- optional `supersedes_id`;
- `correlation_id`;
- optional `causation_id`;
- `created_at`.

Payload updates are not allowed. Corrections are represented by superseding records where the module contract supports supersession.

Mutable operational fields:

- checkpoints may advance only to the same or higher attempt;
- retries may advance only monotonically;
- leases may update only through acquisition, renewal, release, or stale recovery with fencing-token checks;
- pilot lifecycle state changes require the expected previous state;
- daily report delivery status is append-style by attempt and cannot silently overwrite failed delivery evidence.

Repository payload validation rejects unsupported schema versions and malformed persisted JSON before returning records to callers.
