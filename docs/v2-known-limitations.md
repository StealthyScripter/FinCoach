# FinCoach V2 Known Limitations

## Cloud Campaigns Not Yet Executed

The five-year and ten-year replay campaigns have not been run by this agent. They require human-provisioned cloud resources, historical datasets, PostgreSQL, and retained artifacts.

This is nonblocking for manual cloud deployment readiness, but it blocks any claim that long-duration campaigns passed.

## Historical Source Throughput

The historical replay source is bounded-memory and checkpoint-compatible, but the current implementation favors correctness and deterministic ordering over maximum throughput. Large campaigns should start with one-symbol five-year runs and use telemetry to size worker counts, batch size, checkpoint interval, disk, memory, and PostgreSQL capacity.

## CSV Format

CSV is planned but not currently supported at runtime. Historical partitions must use JSONL or NDJSON. A manifest that advertises CSV is rejected.

## Dataset Acquisition Boundary

FinCoach now provides an OANDA-practice dataset builder for historical candles. The operator must still provide OANDA practice credentials, cloud storage, PostgreSQL, and enough runtime capacity. Non-OANDA historical datasets still require externally prepared manifests that satisfy the historical dataset contract.

The OANDA builder currently supports historical candles, not economic releases, corporate events, or fundamental publication datasets. Those record types remain supported by the replay dataset contract, but they are not acquired from OANDA by this pipeline.

## Cloud Capacity

Local verification proves the tooling and bounded-memory behavior on sample data. It does not prove multi-year throughput, database growth, or cost. Cloud capacity must be measured from Gate 2 onward.

## Replay State Storage

The replay verification runner writes artifacts and source cursors for campaign validation. Long-running cloud jobs must preserve output directories and checkpoints on persistent storage. Generated artifacts must not be committed.

Completed historical runs can be resumed idempotently without rewriting successful artifacts. Partial artifact-only historical resume fails closed unless durable replay state is available; operators should preserve checkpoints and restart through the gated campaign workflow rather than editing artifacts.

## Release Boundary

This release candidate remains demo-only. It is not a live-trading release and does not authorize broker execution, Telegram delivery, or external actionable signal publication.
