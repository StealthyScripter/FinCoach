# FinCoach V2 Release Readiness

## Scope

This release candidate is certified only for controlled quantitative research, historical replay, deterministic cloud verification, and demo-only research operations.

It is not certified for live trading, unattended broker execution, or production capital deployment.

## Verdict

`ready_for_oanda_dataset_build_and_cloud_replay`

The OANDA historical dataset workflow is now automated for practice historical candles. Operators no longer need to hand-author OANDA candle manifests: FinCoach can acquire practice candles, normalize through the V2 market-data contract, write replay-ready partitions, hash them, generate the dataset manifest, and validate it before cloud replay gates begin.

The release-blocking full-materialization defect has been corrected. Historical replay now uses a public bounded `ReplaySource` contract and the historical runner consumes dataset records incrementally. Local verification passed for fixture replay, historical sample replay, batch-size determinism, restart/resume behavior, PostgreSQL storage, and safety scans.

This verdict means the human operator can build OANDA practice historical candle datasets, validate their replay manifests, deploy the release candidate, and begin the gated cloud verification campaign. It does not mean the five-year or ten-year campaigns have passed.

## Resolved Blockers

- Historical replay no longer requires constructing a full `ReplaySourceEvent[]` before replay starts.
- Historical mode uses `HistoricalDatasetReplaySource`; fixture generation remains available only for fixture mode.
- Runtime file support is explicit: JSONL/NDJSON with `none` or `gzip` compression. CSV is rejected until implemented.
- Replay checkpoints now carry a replay cursor plus a source cursor bound to the dataset manifest hash.
- Streaming replay state no longer retains all delivered event IDs; it retains the latest source-event marker needed for duplicate protection.
- Historical resume no longer falls back to fixture events.
- Replay result validation now checks manifest hashes, historical dataset hashes, partition validation, and input-summary consistency instead of only checking artifact names.
- A gated cloud release coordinator script now wraps the manual campaign stages without automatically advancing past a gate.
- Completed historical resume is idempotent; partial artifact-only resume fails closed rather than overwriting successful artifacts.
- OANDA practice historical candle acquisition is practice-only, bounded by request windows, restartable through committed window spools, and separated from deterministic replay execution.
- Dataset partitions are written atomically from committed acquisition windows and validated before replay preflight.

## Local Verification Summary

- `npm run check`: passed.
- `npm test`: passed.
- `npm run build`: passed.
- `set -a; source .env; set +a; npm run test:pgstorage`: passed.
- `server/v2.historical-replay-dataset.test.ts`: passed.
- 20 repeated historical replay runs: passed.
- PostgreSQL evidence repository test: passed.
- PostgreSQL restart recovery test: passed.
- Shell syntax validation for replay scripts: passed.
- Safety scans found no broker, Telegram, or external signal path used by replay.
- Local release campaign passed with two symbols, two timeframes, three partitions, gzip plus uncompressed input, six input events, eleven output events, three checkpoints, four source reads, and peak heap near 10 MB.
- Docker image build passed and Compose config validated with an explicit external `DATABASE_URL`.

## Release Safety

Replay manifests and scripts require demo-safe state:

- live execution blocked;
- broker execution disabled;
- Telegram delivery disabled;
- external signal publication disabled;
- dataset validation before historical replay;
- PostgreSQL verification before cloud campaign execution;
- nonzero exit on critical result validation failure.

## Deterministic Cloud Gate Sequence

Do not continue past a failed gate.

1. Dataset Gate A: OANDA practice dataset build.
2. Dataset Gate B: Dataset validation.
3. Cloud Gate 0: Preflight.
4. Cloud Gate 1: Verify mode.
5. Cloud Gate 2: Five-year single symbol.
6. Cloud Gate 3: Repeat and compare five-year single-symbol run.
7. Cloud Gate 4: Five-year multi-symbol run.
8. Cloud Gate 5: Restart campaign.
9. Cloud Gate 6: Ten-year single-symbol run.
10. Cloud Gate 7: Ten-year multi-symbol run.
11. Cloud Gate 8: Independent ten-year comparison.

The preferred command wrapper is `scripts/v2-replay/run-gated-cloud-release.sh`. Each invocation runs one explicit stage and exits nonzero on failure.

## Rollback Guidance

If a cloud gate fails:

1. Stop the campaign.
2. Preserve `manifest.json`, `manifest.sha256`, checkpoints, logs, and result artifacts.
3. Run `npm run v2:replay:validate -- --output <OUTPUT_DIR>`.
4. Classify the failure as environmental, data, deterministic, persistence, resource, safety, or FinCoach defect.
5. Do not compare deterministic outputs across different commits.
6. If code is corrected, create a new commit, new run ID, and new manifest.
