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

For ten-year or multi-symbol campaigns, use the same flow with a manifest that records the expanded boundaries. Do not claim a campaign completed until the final `summary.json`, `failures.json`, and `report.md` are produced and validated.

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
