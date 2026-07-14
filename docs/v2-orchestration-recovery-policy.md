# V2 Orchestration Recovery Policy

Orchestration recovery is based on idempotency keys, consumer checkpoints, retry budgets, dead letters, and worker leases.

- Duplicate idempotency keys are rejected.
- Retryable dependency failures emit `ConsumerRetryScheduled` until the retry budget is exhausted.
- Terminal and unknown failures are observable and fail closed into dead-letter evidence.
- Poison events are quarantined and do not loop.
- Stale worker leases can be recovered by another worker.
- Checkpoints are written only after consumer completion.

PostgreSQL durability is available through `PgOrchestrationRepository`. The in-memory repository remains available for deterministic tests and explicitly ephemeral local runs.

Durable recovery behavior:

- `v2_orchestration_cycles` stores one row per cycle ID and a unique idempotency key.
- `v2_orchestration_consumer_acknowledgements` suppresses duplicate consumer completion after restart. Exact duplicate acknowledgements are idempotent; mismatched result hashes are conflicting duplicates.
- `acknowledgeAndCheckpoint` writes the acknowledgement and checkpoint in one transaction. If either write fails, neither is reported as progress.
- `v2_orchestration_retries` persists attempt count and exhausted state. Restart does not reset retry budget.
- `v2_orchestration_worker_leases` uses `lease_name` ownership plus `fencing_token`. Lease acquisition is atomic; recovery increments the fencing token; stale owners cannot renew or release as current owners.
- `v2_orchestration_dead_letters` is append-only by source event and reason. Replay requests increment replay evidence and do not erase the original record.

Unknown PostgreSQL failures fail closed. Missing tables or columns are treated as migration mismatch, not as availability skips.
