#!/usr/bin/env bash
set -euo pipefail

LOAD_ENV=0
CONFIG=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --load-env) LOAD_ENV=1; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [[ "$LOAD_ENV" == "1" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

[[ "${OANDA_ENV:-}" == "practice" ]] || { echo "OANDA_ENV=practice is required" >&2; exit 1; }
[[ "${DATASET_ENVIRONMENT:-practice}" == "practice" ]] || { echo "DATASET_ENVIRONMENT=practice is required" >&2; exit 1; }
[[ "${MARKETPILOT_DEMO_ONLY:-}" == "true" ]] || { echo "MARKETPILOT_DEMO_ONLY=true is required" >&2; exit 1; }
[[ "${FINCOACH_LIVE_EXECUTION:-blocked}" != "enabled" ]] || { echo "live execution enabled" >&2; exit 1; }
[[ "${DOWNLOAD_CONCURRENCY:-1}" == "1" ]] || { echo "bounded OANDA acquisition currently requires DOWNLOAD_CONCURRENCY=1" >&2; exit 1; }

if [[ ${#ARGS[@]} -eq 0 ]]; then
  : "${DATASET_OUTPUT:?DATASET_OUTPUT required}"
  : "${SYMBOLS:?SYMBOLS required}"
  : "${TIMEFRAMES:?TIMEFRAMES required}"
  : "${START_TIME:?START_TIME required}"
  : "${END_TIME:?END_TIME required}"
  ARGS=(--symbols "$SYMBOLS" --timeframes "$TIMEFRAMES" --start "$START_TIME" --end "$END_TIME" --price "${PRICE_COMPONENT:-bid_ask}" --output "$DATASET_OUTPUT" --compression "${COMPRESSION:-gzip}" --max-candles-per-request "${MAX_CANDLES_PER_REQUEST:-5000}" --rate-limit-ms "${RATE_LIMIT_MS:-250}")
  [[ "${RESUME:-true}" != "false" ]] && ARGS+=(--resume)
fi

npm run v2:dataset:oanda:build -- "${ARGS[@]}"
