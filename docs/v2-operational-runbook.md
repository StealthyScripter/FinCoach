# V2 Operational Runbook

Operators should monitor queue depth, active leases, stale lease recovery, open circuit breakers, retry exhaustion, dead-letter counts, audit-chain integrity, and estimated research cost.

Live execution remains blocked during Version 2 operations.

## Read Projection Checks

Before an extended pilot, operators should confirm:

- `GET /api/v2/status` reports PostgreSQL health as healthy when durable repositories are configured.
- Unconfigured collections explicitly show `not_configured`.
- Empty durable collections show `available_empty`.
- Malformed persisted payloads produce degraded module availability.
- Daily reports have one durable identity per report date.
- Failed delivery state remains failed until a distinct successful delivery attempt is recorded.

Projection degradation is operationally significant but does not imply live-trading readiness. Live execution remains blocked regardless of projection health.
