# V2 Reliability and Scale

Version 2 reliability hardening centralizes leases, retry budgets, circuit breakers, payload limits, endpoint allowlists, dead-letter replay requests, and tamper-evident audit records in a governance boundary.

Domain modules do not own worker locks or retry policy.

## Durable Operational Stores

Milestone B adds PostgreSQL-backed operational repositories without removing the deterministic in-memory repositories used by focused unit tests and explicitly ephemeral development runs.

Durable mode is explicit. If a durable repository is configured and PostgreSQL is unavailable, the repository fails closed with a typed persistence error instead of falling back to process memory.

Module-owned tables:

- `orchestration`: `v2_orchestration_cycles`, `v2_orchestration_checkpoints`, `v2_orchestration_consumer_acknowledgements`, `v2_orchestration_retries`, `v2_orchestration_worker_leases`, `v2_orchestration_dead_letters`.
- `pilot`: `v2_pilot_lifecycle`, `v2_pilot_lifecycle_transitions`, `v2_pilot_scorecards`, `v2_pilot_reports`.
- `operations`: `v2_operations_daily_reports`, `v2_operations_daily_report_deliveries`.

Operational mutation is constrained:

- consumer acknowledgements are append-only and idempotent by `idempotency_key`;
- checkpoints advance transactionally and reject regressed attempts;
- retry attempts are monotonic and retry exhaustion persists across repository recreation;
- worker leases use `lease_name` plus a fencing token so stale owners cannot renew after recovery;
- pilot lifecycle transitions require the expected previous state;
- scorecard updates write an immutable scorecard snapshot and update current pilot state in one transaction;
- daily report delivery records preserve failed delivery state and reject ambiguous delivery as success.

Indexes are defined for recovery queries: active or expired leases, pending retries, dead-letter replay candidates, latest pilot scorecards, latest reports, and delivery status.
