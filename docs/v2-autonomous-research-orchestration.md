# V2 Autonomous Research Orchestration

The orchestration module coordinates public V2 domain events through registered consumers. It does not perform chart analysis, hypothesis generation, rule evaluation, backtesting, courtroom policy, ranking, Telegram transport, lifecycle policy, or broker execution.

Every routed event preserves the V2 domain envelope and emits operational evidence for routing, consumer execution, checkpointing, retries, dead letters, leases, and cancellation.

Live execution remains blocked. The orchestrator has no order placement API.
