# V2 OANDA Historical Dataset Workflow

This workflow builds replay-ready historical candle datasets from OANDA practice market-data endpoints. It is a read-only data acquisition path for controlled research and historical replay. It does not authorize live trading, practice orders, Telegram delivery, or external signal publication.

## Safety Requirements

The builder fails closed unless all of the following are true:

- `OANDA_ENV=practice`
- `MARKETPILOT_DEMO_ONLY=true`
- `FINCOACH_LIVE_EXECUTION` is not `enabled`
- `OANDA_BASE_URL` is the OANDA practice host, or an explicit local mock host for tests

The historical client only calls the account-instruments endpoint and instrument-candles endpoint. Paths containing orders, trades, positions, close actions, or the live `api-fxtrade` host are rejected. Tokens, account IDs, authorization headers, and database URLs must not be printed or committed.

## Timeframes

FinCoach timeframes map to OANDA granularities explicitly:

| FinCoach | OANDA |
| --- | --- |
| `1m` | `M1` |
| `5m` | `M5` |
| `15m` | `M15` |
| `30m` | `M30` |
| `1h` | `H1` |
| `4h` | `H4` |
| `1d` | `D` |
| `1w` | `W` |
| `1mo` | `M` |

The CLI accepts either FinCoach values or OANDA aliases such as `M15,H1` and normalizes them before building the request. Unsupported values fail before provider access.

## Price Components

Supported request policies are `mid`, `bid`, `ask`, and `bid_ask`. `bid_ask` requests OANDA bid and ask candles and stores both components in the normalized V2 candle payload. Midpoint data is not labeled as bid/ask data.

## Checkpoints And Resume

Acquisition is split into bounded request windows. Each successful window is normalized and written to a committed acquisition spool file before the checkpoint advances. Replay partitions are assembled from committed spool files, so an interrupted run can resume without treating process-local memory as durable state.

Resume rejects changed request configuration, including symbols, timeframes, range, price component, dataset identity, and partition policy. Completed windows are reused only when the committed window file exists.

## Partitions And Hashes

The builder writes JSONL replay partitions with optional gzip compression. Partition files are created through temporary paths and atomically renamed after successful write and hash calculation. The generated `manifest.json` includes partition metadata, record counts, SHA-256 hashes, OANDA source provenance, requested and actual ranges, gap summary, duplicate counts, and builder version.

Generated datasets must validate with:

```bash
npm run v2:dataset:validate -- --manifest <DATASET_OUTPUT>/manifest.json
```

## Operator Commands

Dry-run without provider calls:

```bash
OANDA_ENV=practice \
MARKETPILOT_DEMO_ONLY=true \
FINCOACH_LIVE_EXECUTION=blocked \
OANDA_API_TOKEN=<PRACTICE_TOKEN> \
OANDA_ACCOUNT_ID=<PRACTICE_ACCOUNT> \
npm run v2:dataset:oanda:build -- \
  --symbols EUR_USD \
  --timeframes M15,H1 \
  --start 2020-01-01T00:00:00.000Z \
  --end 2024-12-31T23:59:59.999Z \
  --price bid_ask \
  --output /data/fincoach/datasets/eurusd-five-year \
  --compression gzip \
  --dry-run
```

Build or resume through the operator wrapper:

```bash
bash scripts/v2-replay/build-oanda-dataset.sh \
  --load-env \
  --config config/replay-campaigns/five-year-single.example.env
```

Gated cloud workflow:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh dataset-build --config <CAMPAIGN_ENV>
bash scripts/v2-replay/run-gated-cloud-release.sh dataset-validate --dataset-manifest <DATASET_OUTPUT>/manifest.json
bash scripts/v2-replay/run-gated-cloud-release.sh preflight --expected-commit <RELEASE_COMMIT> --dataset-manifest <DATASET_OUTPUT>/manifest.json --output <OUTPUT_ROOT>/preflight --min-free-disk-gb <MIN_DISK_GB> --min-memory-gb <MIN_MEMORY_GB>
```

## Current Limits

This workflow builds OANDA historical candle datasets only. Economic events, corporate events, and fundamental publication events remain part of the historical replay dataset contract but are not acquired from OANDA by this command.
