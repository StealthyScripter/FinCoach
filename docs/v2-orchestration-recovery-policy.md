# V2 Orchestration Recovery Policy

Orchestration recovery is based on idempotency keys, consumer checkpoints, retry budgets, dead letters, and worker leases.

- Duplicate idempotency keys are rejected.
- Retryable dependency failures emit `ConsumerRetryScheduled` until the retry budget is exhausted.
- Terminal and unknown failures are observable and fail closed into dead-letter evidence.
- Poison events are quarantined and do not loop.
- Stale worker leases can be recovered by another worker.
- Checkpoints are written only after consumer completion.

The current implementation uses an in-memory repository matching the V2 module pattern. PostgreSQL durability can be added behind the repository contract without changing public orchestration contracts.
