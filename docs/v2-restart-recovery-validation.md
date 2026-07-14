# V2 Restart Recovery Validation

Version 2 restart recovery is validated by `server/v2.restart-recovery.pg.test.ts` against PostgreSQL-backed orchestration, pilot, and operations repositories.

Validated recovery cases:

- Active orchestration cycles remain visible after constructing fresh repository instances.
- Consumer acknowledgements remain idempotent after restart and conflicting duplicates fail closed.
- Checkpoints survive restart and transactional acknowledgement/checkpoint rollback leaves no partial checkpoint.
- Expired worker leases are recoverable by a new worker using the lease compare-and-set policy.
- Pending retry state survives restart with the original attempt budget.
- Dead letters survive restart and replay requests increment durable replay evidence.
- Pilot safe-stop state survives restart.
- Daily reports remain durable after creation and before delivery.
- Delivery state remains durable after delivery and before any local caller acknowledgement.
- Database outage during checkpoint, lease renewal, and pilot persistence fails closed.
- Migration mismatch, unsupported schema version, and malformed persisted payload are surfaced as typed persistence failures.
- Duplicate event processing after restart is classified as idempotent rather than generating duplicate downstream work.

Safety invariants checked by the restart suite:

- No duplicate signal count is introduced by recovery.
- No duplicate forward-test count is introduced by recovery.
- No duplicate lifecycle count is introduced by recovery.
- Failed transactional recovery does not report false success.
- Operations status continues to report `liveExecutionBlocked: true`.

The test uses only local PostgreSQL and deterministic fixtures. It does not call external providers, Telegram, OANDA, broker endpoints, or live execution paths.
