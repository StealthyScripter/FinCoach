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

## Release-Candidate Replay Operation

Historical replay release-candidate operation is limited to controlled research and cloud verification. Before any campaign, confirm live execution is blocked, broker execution is disabled, Telegram delivery is disabled, external signal publication is disabled, PostgreSQL is healthy, and the dataset manifest validates.

Do not continue a cloud gate after a failed validator result. Preserve replay artifacts and checkpoints, classify the failure, and only resume from a manifest whose repository commit, dataset hash, and source cursor match the saved state.

The final manual deployment sequence is defined in `docs/v2-cloud-deployment-runbook.md`; rollback procedures are defined in `docs/v2-deployment-rollback.md`.
