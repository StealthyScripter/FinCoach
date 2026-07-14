# V2 Historical Replay Dataset Contract

Historical replay datasets use manifest schema `fincoach.v2.historical-replay-dataset.1`.

Required dataset fields include dataset identity, version, source description, asset classes, symbols, timeframes, coverage timestamps, publication-time policy, revision policy, corporate-action policy, timezone policy, partitions, total record count, hash algorithm, and optional manifest hash.

Partitions are line-oriented `jsonl`, `ndjson`, or `csv` files with `none` or `gzip` compression. Current local verification covers JSONL/NDJSON-style JSON records. Each partition declares its owner symbol/timeframe, coverage, record count, byte size, and SHA-256 content hash.

Supported historical record types are `candle`, `economic_event`, `corporate_event`, `fundamental_publication`, `market_session`, `revision`, and `late_arriving_correction`.

Each record requires explicit event time, effective time, publication time, source ID, source sequence, schema version, and immutable record ID. Publication time is never inferred. Records with effective time after publication time are rejected as future-data policy violations.

Historical ordering is stable by publication timestamp, effective timestamp, event-type priority, symbol, timeframe, source ID, source sequence, and immutable record ID.

The cursor schema `fincoach.v2.historical-replay-cursor.1` binds checkpoints to dataset ID, dataset version, manifest hash, partition ID, partition index, record index, byte offset, last emitted record ID, and last emitted timestamp. Resume is rejected when the dataset identity or manifest hash changes.
