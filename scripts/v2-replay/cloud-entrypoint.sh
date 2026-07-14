#!/usr/bin/env bash
set -euo pipefail

trap 'echo "termination requested; checkpoints preserved in ${REPLAY_OUTPUT_DIR:-artifacts/v2-replay/verify}" >&2' TERM INT

export REPLAY_OUTPUT_DIR="${REPLAY_OUTPUT_DIR:-artifacts/v2-replay/verify}"
echo "FinCoach V2 replay entrypoint"
node --version
npm --version
test "${DATABASE_URL:-}" != "" || { echo "DATABASE_URL missing" >&2; exit 1; }
test "${FINCOACH_LIVE_EXECUTION:-blocked}" != "enabled" || { echo "live execution must remain blocked" >&2; exit 1; }
npm run check
npm run build
npm run test:pgstorage
npm run v2:replay:prepare -- --output "$REPLAY_OUTPUT_DIR"
npm run v2:replay:run -- --manifest "$REPLAY_OUTPUT_DIR/manifest.json"
npm run v2:replay:validate -- --output "$REPLAY_OUTPUT_DIR"
