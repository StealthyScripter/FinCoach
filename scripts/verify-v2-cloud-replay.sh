#!/usr/bin/env bash
set -euo pipefail

trap 'echo "verification interrupted; replay output remains in ${REPLAY_OUTPUT_DIR:-artifacts/v2-replay/verify}" >&2' TERM INT

export REPLAY_OUTPUT_DIR="${REPLAY_OUTPUT_DIR:-artifacts/v2-replay/verify}"
npm ci
npm run check
npm run build
npm test
set -a
source .env
set +a
npm run test:pgstorage
npm run db:push
npm run v2:replay:verify
npm run v2:replay:validate -- --output "$REPLAY_OUTPUT_DIR"
