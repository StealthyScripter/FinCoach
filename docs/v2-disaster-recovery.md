# V2 Disaster Recovery

Recovery procedures use checkpoints, dead-letter records, audit-chain verification, and explicit replay requests. Unknown failures fail closed and remain observable.

The current implementation is repository-backed and can be moved to PostgreSQL durability behind the public repository contract.
