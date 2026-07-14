# V2 Daily Research Report

The daily research report is a normalized operations summary covering observations, hypotheses, experiments, backtests, courtroom verdicts, ranking changes, forward tests, signals, external evaluations, lessons, lifecycle changes, failures, dead letters, data gaps, stale-data incidents, module health, and live execution blocked state.

Duplicate reports for the same date reuse the existing report and do not claim a second delivery.

## Durable Delivery State

Milestone B adds `PgV2OperationsRepository` for report identity and delivery evidence.

Tables:

- `v2_operations_daily_reports`: one durable report identity per report date, with report payload, schema version, status, correlation ID, and timestamps.
- `v2_operations_daily_report_deliveries`: delivery attempts by report, destination, and attempt number, with explicit `pending`, `delivered`, or `failed` state.

Duplicate creation for the same report date is idempotent only when the stored report identity matches. Conflicting duplicates are observable and rejected.

Failed delivery remains failed. Ambiguous delivery is not recorded as delivered and must be resolved through a later explicit delivery attempt. A uniqueness constraint prevents more than one delivered state for the same report and destination.

## Projection Sources

Milestone C generates daily reports from the operations status projection. Durable orchestration, pilot, and report repositories contribute real counts and latest-state fields when configured.

If a required source is degraded or temporarily unavailable, the report is persisted with degraded source evidence rather than pretending the report is complete. Duplicate report dates reuse the persisted report identity.

Delivery destinations are redacted before persistence. Failed delivery evidence is queryable through the operations repository and is not converted to success by retries.
