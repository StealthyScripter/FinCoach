# FinCoach V2 Cloud Release Checklist

Use placeholders literally until replaced by the human operator:

- `<REPOSITORY_PATH>`
- `<DATASET_MANIFEST>`
- `<OUTPUT_ROOT>`
- `<EXPECTED_COMMIT>`
- `<CAMPAIGN_ENV>`

## Repository Verification

```bash
cd <REPOSITORY_PATH>
git status --short
git rev-parse HEAD
git log -1 --oneline
```

The expected release-candidate commit must match `<EXPECTED_COMMIT>`, and the working tree must be clean.

## Environment Setup

```bash
npm ci
npm run check
npm test
npm run build

set -a
source .env
set +a

npm run test:pgstorage
npm run db:push
```

## Cloud Gate 0: Preflight

```bash
EXPECTED_COMMIT=<EXPECTED_COMMIT> \
DATASET_MANIFEST=<DATASET_MANIFEST> \
OUTPUT_DIR=<OUTPUT_ROOT>/preflight \
FINCOACH_REPLAY_MIN_FREE_DISK_GB=<MIN_DISK_GB> \
FINCOACH_REPLAY_MIN_MEMORY_GB=<MIN_MEMORY_GB> \
bash scripts/v2-replay/cloud-preflight.sh \
  --expected-commit <EXPECTED_COMMIT> \
  --dataset-manifest <DATASET_MANIFEST> \
  --output <OUTPUT_ROOT>/preflight \
  --min-free-disk-gb <MIN_DISK_GB> \
  --min-memory-gb <MIN_MEMORY_GB>
```

The same gate can be run through the release coordinator:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh preflight \
  --expected-commit <EXPECTED_COMMIT> \
  --dataset-manifest <DATASET_MANIFEST> \
  --output <OUTPUT_ROOT>/preflight \
  --min-free-disk-gb <MIN_DISK_GB> \
  --min-memory-gb <MIN_MEMORY_GB>
```

## Cloud Gate 1: Verify Mode

```bash
OUTPUT_DIR=<OUTPUT_ROOT>/verify \
bash scripts/v2-replay/run-cloud-verify.sh
```

Coordinator form:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh verify \
  --output <OUTPUT_ROOT>/verify
```

## Cloud Gate 2: Five-Year Single Symbol

Create an env file from `config/replay-campaigns/five-year-single.example.env`, then run:

```bash
bash scripts/v2-replay/run-five-year-single.sh <CAMPAIGN_ENV>
```

Coordinator form:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh five-year-single \
  --config <CAMPAIGN_ENV>
```

## Cloud Gate 3: Repeat And Compare

Run the five-year single-symbol campaign again with the same dataset, symbols, timeframes, seed, and date range, but a different output directory. Then compare summaries:

```bash
bash scripts/v2-replay/compare-campaign-runs.sh \
  <OUTPUT_ROOT>/five-year-single-a/summary.json \
  <OUTPUT_ROOT>/five-year-single-b/summary.json
```

Coordinator form:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh five-year-compare \
  --left <OUTPUT_ROOT>/five-year-single-a/summary.json \
  --right <OUTPUT_ROOT>/five-year-single-b/summary.json
```

## Cloud Gate 4: Five-Year Multi-Symbol

Create an env file from `config/replay-campaigns/five-year-multi.example.env`, then run:

```bash
bash scripts/v2-replay/run-five-year-multi.sh <CAMPAIGN_ENV>
```

## Cloud Gate 5: Restart Campaign

Use a campaign env file with an explicit `RESTART_SCHEDULE`, then run:

```bash
bash scripts/v2-replay/run-restart-campaign.sh <CAMPAIGN_ENV>
```

Compare the restarted campaign with an uninterrupted equivalent run:

```bash
bash scripts/v2-replay/compare-campaign-runs.sh \
  <OUTPUT_ROOT>/five-year-multi/summary.json \
  <OUTPUT_ROOT>/five-year-restart/summary.json
```

## Cloud Gate 6: Ten-Year Single Symbol

Create an env file from `config/replay-campaigns/ten-year-single.example.env`, then run:

```bash
bash scripts/v2-replay/run-ten-year-single.sh <CAMPAIGN_ENV>
```

## Cloud Gate 7: Ten-Year Multi-Symbol

Create an env file from `config/replay-campaigns/ten-year-multi.example.env`, then run:

```bash
bash scripts/v2-replay/run-ten-year-multi.sh <CAMPAIGN_ENV>
```

## Cloud Gate 8: Independent Ten-Year Comparison

Run the ten-year campaign independently a second time with identical manifest inputs and a separate output directory. Then compare:

```bash
bash scripts/v2-replay/compare-campaign-runs.sh \
  <OUTPUT_ROOT>/ten-year-a/summary.json \
  <OUTPUT_ROOT>/ten-year-b/summary.json
```

## Manual Validation And Report

```bash
npm run v2:replay:validate -- --output <OUTPUT_DIR>
npm run v2:replay:report -- <OUTPUT_DIR>/summary.json
```

Coordinator form:

```bash
bash scripts/v2-replay/run-gated-cloud-release.sh finalize \
  --output <OUTPUT_DIR>
```

## Stop Conditions

Stop immediately when any gate reports:

- future-data access;
- deterministic mismatch;
- broken lineage;
- checkpoint divergence;
- changed dataset hash on resume;
- malformed accepted evidence;
- non-finite accepted metric;
- unrecovered critical dead letter;
- live execution enabled;
- broker call;
- Telegram delivery;
- external signal publication;
- PostgreSQL or migration failure;
- missing required artifact;
- nonzero validator exit.
