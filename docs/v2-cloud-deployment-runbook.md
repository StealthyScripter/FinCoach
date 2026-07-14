# FinCoach V2 Cloud Deployment Runbook

## Scope

This runbook deploys FinCoach V2 for controlled quantitative research, historical replay, deterministic replay verification, research-only APIs, read-only V2 Telegram operations, demo-only workflows, independent evaluation ingestion, immutable journaling, and strategy research governance.

It does not authorize live capital deployment, live OANDA trading, unattended broker execution, unrestricted signal execution, or production portfolio allocation.

## Infrastructure Prerequisites

- Linux host, container runtime, or batch worker with persistent disk.
- Node and npm compatible with the lockfile.
- PostgreSQL reachable through `DATABASE_URL`.
- Historical datasets mounted read-only.
- Replay output mounted on persistent writable storage.
- Secrets supplied through the environment, not committed files.
- `FINCOACH_LIVE_EXECUTION=blocked`.
- `BROKER_EXECUTION_ENABLED=false`.
- `TELEGRAM_DELIVERY_ENABLED=false`.
- `EXTERNAL_SIGNAL_PUBLICATION_ENABLED=false`.

## Clone Or Update

```bash
cd <REPOSITORY_PATH>
git fetch --all --tags
git checkout <RELEASE_COMMIT>
git status --short
git rev-parse HEAD
```

## Install And Verify

```bash
npm ci
npm run check
npm test
npm run build
```

## PostgreSQL

```bash
set -a
source .env
set +a

npm run test:pgstorage
npm run db:push
```

`npm run db:push` is the repository migration command currently exposed for this deployment path.

## Gated Release Campaign

Run one gate at a time. Review artifacts before invoking the next gate.

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh dataset-build \
  --config <DATASET_BUILD_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh dataset-validate \
  --dataset-manifest <DATASET_MANIFEST>

bash scripts/v2-replay/run-gated-cloud-release.sh preflight \
  --expected-commit <RELEASE_COMMIT> \
  --dataset-manifest <DATASET_MANIFEST> \
  --output <OUTPUT_ROOT>/preflight \
  --min-free-disk-gb <MIN_DISK_GB> \
  --min-memory-gb <MIN_MEMORY_GB>

bash scripts/v2-replay/run-gated-cloud-release.sh verify \
  --output <OUTPUT_ROOT>/verify

bash scripts/v2-replay/run-gated-cloud-release.sh five-year-single \
  --config <FIVE_YEAR_SINGLE_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh five-year-repeat \
  --config <FIVE_YEAR_REPEAT_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh five-year-compare \
  --left <OUTPUT_ROOT>/five-year-single/summary.json \
  --right <OUTPUT_ROOT>/five-year-repeat/summary.json

bash scripts/v2-replay/run-gated-cloud-release.sh five-year-multi \
  --config <FIVE_YEAR_MULTI_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh restart-campaign \
  --config <RESTART_CAMPAIGN_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh ten-year-single \
  --config <TEN_YEAR_SINGLE_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh ten-year-repeat \
  --config <TEN_YEAR_REPEAT_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh ten-year-compare \
  --left <OUTPUT_ROOT>/ten-year-single/summary.json \
  --right <OUTPUT_ROOT>/ten-year-repeat/summary.json

bash scripts/v2-replay/run-gated-cloud-release.sh ten-year-multi \
  --config <TEN_YEAR_MULTI_ENV>

bash scripts/v2-replay/run-gated-cloud-release.sh finalize \
  --output <FINAL_OUTPUT_DIR>
```

## Individual Recovery Commands

```bash
npm run v2:dataset:resume -- --symbols <SYMBOLS> --timeframes <TIMEFRAMES> --start <START> --end <END> --price <PRICE_COMPONENT> --output <DATASET_OUTPUT>
npm run v2:dataset:validate -- --manifest <DATASET_OUTPUT>/manifest.json
npm run v2:replay:resume -- --manifest <OUTPUT_DIR>/manifest.json --batch-size <BATCH_SIZE>
npm run v2:replay:validate -- --output <OUTPUT_DIR>
npm run v2:replay:compare -- --left <LEFT_SUMMARY_JSON> --right <RIGHT_SUMMARY_JSON>
npm run v2:replay:report -- <OUTPUT_DIR>/summary.json
```

Completed historical resume is idempotent. Partial artifact-only historical resume fails closed unless durable replay state is available.

OANDA dataset acquisition is a separate immutable dataset stage. Replay gates must use the frozen manifest and hashes from `dataset-validate`; replay execution never downloads provider data.

## Stop Conditions

Stop immediately on future-data access, deterministic mismatch, broken lineage, checkpoint divergence, dataset hash mismatch, malformed accepted evidence, non-finite accepted metric, unrecovered critical dead letter, PostgreSQL failure, migration failure, live execution enabled, broker call, Telegram delivery, external signal publication, missing required artifact, or nonzero validator exit.

## Artifact Retention

Retain `manifest.json`, `manifest.sha256`, dataset manifest references, partition validation, checkpoints, metrics, telemetry snapshots, validation files, `summary.json`, `failures.json`, and `report.md` until the release decision is reviewed.
