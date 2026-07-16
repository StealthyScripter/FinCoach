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
npm run db:restore:verify -- --backup "${FINCOACH_DB_BACKUP_PATH:?set FINCOACH_DB_BACKUP_PATH}" --checksum "${FINCOACH_DB_BACKUP_SHA256_PATH:?set FINCOACH_DB_BACKUP_SHA256_PATH}"
npm run db:migrate:status
npm run db:migrate:verify
npm run v2:replay:verify
npm run v2:replay:validate -- --output "$REPLAY_OUTPUT_DIR"
