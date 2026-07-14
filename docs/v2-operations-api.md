# V2 Operations API

Version 2 operations endpoints expose transport-safe read models under `/api/v2/*`. Routes validate pagination, propagate request correlation IDs, redact sensitive signal fields, and always report `liveExecutionBlocked: true`.

Routes do not rank strategies, compute verdicts, reconcile evaluations, publish signals, or place orders.

## Persisted Projections

Milestone C replaces demo fixture records with source-backed projections.

Availability states:

- `available`: persisted records were found and returned from a public repository or query contract.
- `available_empty`: the public repository is reachable but has no matching records.
- `degraded`: the source exists but returned malformed data or another contained failure.
- `stale`: the source is reachable but outside freshness policy.
- `not_configured`: the upstream module does not yet expose a durable projection for this collection.
- `temporarily_unavailable`: PostgreSQL or a module dependency is unavailable.
- `schema_incompatible`: migrations or persisted schema versions do not match supported contracts.

`GET /api/v2/status` now includes persisted orchestration, pilot, and daily-report fields when durable repositories are provided: latest successful and failed cycles, retry counts, active and stale leases, dead-letter count, pilot state, latest scorecard, latest daily report, delivery state, PostgreSQL health, and module availability.

Collection endpoints preserve the existing JSON envelope and pagination fields. Collections without a durable read projection return `items: []` with `availability: "not_configured"` instead of fabricated demo records.
