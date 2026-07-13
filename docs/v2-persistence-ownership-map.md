# V2 Persistence Ownership Map

This map classifies V2 records before adding PostgreSQL tables. Module ownership remains strict: modules own their records and expose public contracts; no module may read another module's private tables.

Durable before an extended demo pilot:

- `orchestration_cycle`: owner `orchestration`; natural key `cycleId`; idempotency key `idempotencyKey`; mutable operational state; required for active-cycle restart.
- `orchestration_checkpoint`: owner `orchestration`; natural key `consumerId`; idempotency key `consumerId + sourceEventId`; mutable operational state; required for checkpoint resume.
- `consumer_acknowledgement`: owner `orchestration`; natural key `sourceEventId + consumerId`; idempotency key `idempotencyKey`; append-only; required for duplicate suppression.
- `retry_state`: owner `orchestration`; natural key `sourceEventId + consumerId`; idempotency key `sourceEventId + consumerId + attempt`; mutable operational state; required for retry budget recovery.
- `worker_lease`: owner `orchestration`; natural key `leaseName`; idempotency key `leaseName`; mutable by compare-and-set; required for multi-worker safety.
- `dead_letter`: owner `orchestration`; natural key `deadLetterId`; idempotency key `sourceEventId + reason`; append-only; required for poison/terminal event recovery.
- `pilot_lifecycle`: owner `pilot`; natural key `pilotId`; idempotency key `pilotId + transition`; mutable current state plus transition history; required for pilot restart.
- `pilot_scorecard`: owner `pilot`; natural key `pilotId`; idempotency key `pilotId + scorecardVersion`; mutable operational scorecard; required for safe-stop and reports.
- `daily_report`: owner `operations`; natural key `reportDate`; idempotency key `reportDate`; append-only; required for duplicate-report prevention.
- `daily_report_delivery`: owner `operations`; natural key `reportId + destination`; idempotency key `reportId + destination + deliveryAttempt`; explicit delivery status; required to avoid duplicate delivery and preserve failures.

Durable recommended after operational stores:

- forward tests, research signals, external evaluations, journal entries, lessons, lifecycle decisions, strategy revisions, court verdicts, ranking decisions, and reliability audit-chain records.

Safe to recompute or ephemeral:

- chart analysis, feature vectors, and replay cursors are deterministic or explicitly ephemeral.

The executable source of truth for this inventory is `server/v2/governance/persistenceInventory.ts`.
