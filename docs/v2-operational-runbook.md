# V2 Operational Runbook

Operators should monitor queue depth, active leases, stale lease recovery, open circuit breakers, retry exhaustion, dead-letter counts, audit-chain integrity, and estimated research cost.

Live execution remains blocked during Version 2 operations.

## Read Projection Checks

Before an extended pilot, operators should confirm:

- `GET /api/v2/status` reports PostgreSQL health as healthy when durable repositories are configured.
- `GET /api/v2/metrics` reports provider-neutral V2 telemetry health, bounded metrics, and redacted operational events.
- Unconfigured collections explicitly show `not_configured`.
- Empty durable collections show `available_empty`.
- Malformed persisted payloads produce degraded module availability.
- Daily reports have one durable identity per report date.
- Failed delivery state remains failed until a distinct successful delivery attempt is recorded.

Projection degradation is operationally significant but does not imply live-trading readiness. Live execution remains blocked regardless of projection health.

## Evidence Repository Checks

For V2.1 durable evidence mode, verify:

- migration `0015_v2_evidence_persistence.sql` is applied;
- PostgreSQL repositories are explicitly constructed for evidence modules that require durability;
- in-memory repositories are used only for unit tests, deterministic fixtures, or explicitly ephemeral local runs;
- operations projections receive the durable repositories they are expected to expose;
- duplicate records return idempotent results only when the immutable payload is identical;
- conflicting duplicates are treated as conflicts, not successful updates;
- malformed persisted rows and unsupported schema versions fail closed.
