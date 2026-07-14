# V2 Alerting Policy

## Critical Alerts

Alert immediately for live execution blocker unavailability, kill switch failure, PostgreSQL unavailability, migration mismatch, queue growth, retry exhaustion, critical dead letters, deterministic replay mismatch, future-data violation, stale market data blocking action, signal emission after pilot stop, sustained lease contention, checkpoint failure, audit-chain failure, unbounded replay memory growth, Telegram delivery failure bursts, or required provider outage.

## Warning Alerts

Warn on degraded telemetry, low but bounded replay throughput, optional provider degradation, noncritical dead letters, elevated but bounded memory growth, and cloud resource throttling.

Warnings must appear in reports and dashboards. They are not silently converted into success.

## Recommended Views

Recommended views are system health, research throughput, data quality, experiment pipeline, backtest quality, courtroom outcomes, strategy lifecycle, forward testing, external evaluation, replay verification, persistence and PostgreSQL, and pilot operations.
