#!/usr/bin/env bash
set -euo pipefail
trap 'echo "verify interrupted; artifacts preserved in ${OUTPUT_DIR:-artifacts/v2-replay/cloud-verify}" >&2' TERM INT
OUTPUT_DIR="${OUTPUT_DIR:-artifacts/v2-replay/cloud-verify}"
bash scripts/v2-replay/cloud-preflight.sh --output "$OUTPUT_DIR" --min-free-disk-gb "${FINCOACH_REPLAY_MIN_FREE_DISK_GB:-1}" --min-memory-gb "${FINCOACH_REPLAY_MIN_MEMORY_GB:-1}"
npm run v2:replay:prepare -- --mode fixture --output "$OUTPUT_DIR"
npm run v2:replay:run -- --manifest "$OUTPUT_DIR/manifest.json"
npm run v2:replay:validate -- --output "$OUTPUT_DIR"
npm run v2:replay:report -- "$OUTPUT_DIR/summary.json"
