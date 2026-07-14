# V2 Historical Replay Dataset Contract

Historical replay datasets use manifest schema `fincoach.v2.historical-replay-dataset.1`.

Required dataset fields include dataset identity, version, source description, asset classes, symbols, timeframes, coverage timestamps, publication-time policy, revision policy, corporate-action policy, timezone policy, partitions, total record count, hash algorithm, and optional manifest hash.

Partitions are line-oriented `jsonl` or `ndjson` files with `none` or `gzip` compression. CSV is not a supported runtime format in this release candidate. Each partition declares its owner symbol/timeframe, coverage, record count, byte size, and SHA-256 content hash.

Partition files must already be deterministically ordered. The reader validates monotonic record ordering while streaming and rejects out-of-order partitions instead of buffering whole files to sort them.

Supported historical record types are `candle`, `economic_event`, `corporate_event`, `fundamental_publication`, `market_session`, `revision`, and `late_arriving_correction`.

Each record requires explicit event time, effective time, publication time, source ID, source sequence, schema version, and immutable record ID. Publication time is never inferred. Records with effective time after publication time are rejected as future-data policy violations.

Historical ordering is stable by publication timestamp, effective timestamp, event-type priority, symbol, timeframe, source ID, source sequence, and immutable record ID.

The cursor schema `fincoach.v2.historical-replay-cursor.1` binds checkpoints to dataset ID, dataset version, manifest hash, partition ID, partition index, record index, byte offset, last emitted record ID, and last emitted timestamp. Resume is rejected when the dataset identity or manifest hash changes.

The public replay source cursor `fincoach.v2.replay-source.historical-dataset.1` additionally stores source position, last emitted event ID, last ordering key, and dataset manifest hash. It is the cursor persisted with replay checkpoints for streaming campaigns.

## OANDA Dataset Builder

`npm run v2:dataset:oanda:build` builds this manifest automatically from OANDA practice historical candles. It requires `OANDA_ENV=practice`, `MARKETPILOT_DEMO_ONLY=true`, a blocked live-execution state, `OANDA_API_TOKEN`, and `OANDA_ACCOUNT_ID`.

The builder calls only read-only practice endpoints for instruments and candles. It rejects the live `api-fxtrade` host and refuses order, trade, position-close, or execution paths. Normal verification uses mocked OANDA responses; real-provider smoke tests must be run manually with an explicit operator decision.

The builder maps FinCoach timeframes to OANDA granularities as follows: `1m=M1`, `5m=M5`, `15m=M15`, `30m=M30`, `1h=H1`, `4h=H4`, `1d=D`, `1w=W`, `1mo=M`.

The default price policy is `bid_ask`, preserving bid and ask OHLC and deriving spread through the existing V2 market-data normalization contract. Midpoint-only data is never labeled as bid/ask.

Each OANDA request window is normalized and written to a committed acquisition spool before the checkpoint advances. Output partitions are assembled from committed spools, written atomically through temporary files, hashed with SHA-256, validated, and then referenced by `manifest.json`. Resume rejects changed request configuration and refuses to skip a completed window unless the committed spool file exists.
