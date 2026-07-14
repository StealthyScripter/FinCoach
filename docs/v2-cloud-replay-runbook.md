# V2 Cloud Replay Runbook

## Prerequisites

- A clean checkout of the exact FinCoach commit to validate.
- Node and npm matching the repository lockfile.
- PostgreSQL reachable through `DATABASE_URL`.
- Required migrations applied through the repository migration command.
- Live execution disabled. `FINCOACH_LIVE_EXECUTION=enabled` is rejected.
- No broker or Telegram delivery flags enabled.
- Historical input data staged outside tracked source with recorded SHA-256 hashes.

Do not store provider credentials, database dumps, replay outputs, checkpoints, or logs in Git.

The agent prepares tooling and local verification only. A human operator provisions cloud resources, supplies historical datasets, runs campaign scripts, pays cloud costs, and retains artifacts.

## Historical Preflight

```bash
bash scripts/v2-replay/cloud-preflight.sh \
  --expected-commit 73c5722 \
  --dataset-manifest /data/fincoach/datasets/fx-five-year/manifest.json \
  --output /var/lib/fincoach/replay/five-year-single \
  --min-free-disk-gb 200 \
  --min-memory-gb 16
```

Preflight checks the clean tree, Node/npm, package scripts, PostgreSQL configuration, dataset manifest, partition hashes, output writability, disk, memory, live-execution block, broker flags, Telegram flags, external signal flags, and Git ignore behavior.

## Local Verify Command

```bash
npm run v2:replay:verify
npm run v2:replay:validate -- --output artifacts/v2-replay/verify
```

## Cloud Entrypoint

```bash
bash scripts/v2-replay/cloud-entrypoint.sh
```

The entrypoint:

- verifies Node and npm versions are visible;
- requires `DATABASE_URL` without printing it;
- rejects live execution;
- runs `npm run check`;
- runs `npm run build`;
- runs PostgreSQL storage tests;
- prepares a manifest;
- runs replay;
- validates result artifacts;
- preserves output on termination.

Replay verification records V2 telemetry counters, gauges, histograms, and redacted operational events when the runner supplies a telemetry service. Cloud reports should archive the telemetry snapshot with replay artifacts.

## Full Cloud Verification

```bash
bash scripts/verify-v2-cloud-replay.sh
```

This script performs dependency installation, static checks, build, unit tests, PostgreSQL tests, migration push, replay verify, and result validation. It uses `set -euo pipefail` and exits nonzero on the first failed gate.

## Five-Year and Ten-Year Campaigns

Prepare a manifest with real dataset identifiers, exact date range, symbols, timeframes, dataset hashes, and an output directory:

```bash
npm run v2:replay:prepare -- --output artifacts/v2-replay/five-year
npm run v2:replay:run -- --manifest artifacts/v2-replay/five-year/manifest.json
npm run v2:replay:validate -- --output artifacts/v2-replay/five-year
```

Historical campaign example:

```bash
bash scripts/v2-replay/run-five-year-single.sh config/replay-campaigns/five-year-single.example.env
```

Campaign env files may set `BATCH_SIZE`. Smaller batches reduce retained replay-source memory and increase source reads; larger batches reduce read overhead. Domain results must remain stable across batch size.

Release-candidate cloud execution uses the gated command sequence in `docs/v2-cloud-release-checklist.md`. Five-year and ten-year scripts must be driven by explicit campaign env files and historical dataset manifests. Do not use fixture mode for long historical campaigns.

The preferred release-candidate entry point is `scripts/v2-replay/run-gated-cloud-release.sh`. It runs exactly one named gate per invocation, requires explicit operator continuation between gates, blocks broker/Telegram/external signal flags, and returns nonzero on the first failed command.

Every historical campaign must be validated and reported after the run:

```bash
npm run v2:replay:validate -- --output <OUTPUT_DIR>
npm run v2:replay:report -- <OUTPUT_DIR>/summary.json
```

The validator reads the output directory and rejects missing artifacts, malformed summaries, manifest hash mismatches, historical dataset hash mismatches, failed partition validation, input-summary count mismatches, unsafe safety state, and critical replay failures.

For ten-year or multi-symbol campaigns, use the same flow with a manifest that records the expanded boundaries. Do not claim a campaign completed until the final `summary.json`, `failures.json`, and `report.md` are produced and validated.

Cloud final reports should include throughput, memory, checkpoint latency, retry and dead-letter counts, module latency distribution, temporal violations, deterministic mismatches, lineage failures, and safety state.

## Resume

```bash
npm run v2:replay:resume -- --manifest artifacts/v2-replay/five-year/manifest.json
```

Resume mode reuses the manifest and checkpoint directory. If the latest checkpoint is missing or corrupted, validation must fail instead of silently restarting from an unsafe point.

## Compare

```bash
npm run v2:replay:compare -- --left artifacts/v2-replay/run-a --right artifacts/v2-replay/run-b
```

The comparison is successful only when both runs passed and the domain-event hash matches.

## Cleanup

Replay outputs are ignored under `artifacts/v2-replay/`. Remove stale cloud artifacts only after preserving any required audit summaries outside the repository.
