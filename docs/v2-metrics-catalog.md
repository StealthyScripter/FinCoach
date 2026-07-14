# V2 Metrics Catalog

## Implemented Metric Families

- `v2_replay_events_processed_total`: replay source events processed.
- `v2_replay_domain_events_total`: domain events emitted by replay verification.
- `v2_replay_checkpoint_count`: checkpoint count from the latest replay verification run.
- `v2_replay_duration_ms`: replay verification duration distribution.
- `v2_forward_tests_projected_total`: operations projection count used by the operational-maturity PG test.

## Recommended Metric Families

The telemetry contract is ready for module-by-module adoption across market data, features, fundamentals, observations, hypotheses, experiments, backtests, courtroom, ranking, forward testing, signals, external evaluation, journal, learning, ML support, strategy evolution, lifecycle, orchestration, pilot, operations, and replay verification.

## Cardinality Policy

Metrics must not label with event IDs, correlation IDs, causation IDs, strategy IDs, signal IDs, raw symbols across unlimited universes, account identifiers, raw error messages, or user input. Use structured operational events or durable evidence records for those values.
