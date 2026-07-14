# FinCoach V2 Known Limitations

## Cloud Campaigns Not Yet Executed

The five-year and ten-year replay campaigns have not been run by this agent. They require human-provisioned cloud resources, historical datasets, PostgreSQL, and retained artifacts.

## Historical Source Throughput

The historical replay source is bounded-memory and checkpoint-compatible, but the current implementation favors correctness and deterministic ordering over maximum throughput. Large campaigns should start with one-symbol five-year runs and use telemetry to size worker counts, batch size, checkpoint interval, disk, memory, and PostgreSQL capacity.

## CSV Format

CSV is planned but not currently supported at runtime. Historical partitions must use JSONL or NDJSON. A manifest that advertises CSV is rejected.

## Dataset Responsibility

The operator must provide historical datasets with publication timestamps, effective timestamps, deterministic source ordering, content hashes, and manifest metadata. Records missing point-in-time visibility metadata are rejected rather than inferred.

## Cloud Capacity

Local verification proves the tooling and bounded-memory behavior on sample data. It does not prove multi-year throughput, database growth, or cost. Cloud capacity must be measured from Gate 2 onward.

## Replay State Storage

The replay verification runner writes artifacts and source cursors for campaign validation. Long-running cloud jobs must preserve output directories and checkpoints on persistent storage. Generated artifacts must not be committed.

## Release Boundary

This release candidate remains demo-only. It is not a live-trading release and does not authorize broker execution, Telegram delivery, or external actionable signal publication.
