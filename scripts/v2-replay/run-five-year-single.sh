#!/usr/bin/env bash
set -euo pipefail
source "${1:?campaign env file required}"
bash scripts/v2-replay/cloud-preflight.sh --dataset-manifest "$DATASET_MANIFEST" --output "$OUTPUT_DIR" --min-free-disk-gb "$MIN_FREE_DISK_GB" --min-memory-gb "$MIN_MEMORY_GB"
npm run v2:replay:prepare -- --mode historical --dataset-manifest "$DATASET_MANIFEST" --start "$START_TIME" --end "$END_TIME" --symbols "$SYMBOLS" --timeframes "$TIMEFRAMES" --seed "$SEED" --checkpoint-interval "$CHECKPOINT_INTERVAL" --worker-count "$WORKER_COUNT" --restart-schedule "${RESTART_SCHEDULE:-}" --output "$OUTPUT_DIR"
npm run v2:replay:run -- --manifest "$OUTPUT_DIR/manifest.json"
npm run v2:replay:validate -- --output "$OUTPUT_DIR"
