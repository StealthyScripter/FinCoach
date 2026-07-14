#!/usr/bin/env bash
set -euo pipefail
source "${1:?campaign env file required}"
export RESTART_SCHEDULE="${RESTART_SCHEDULE:-1000,5000,10000}"
bash scripts/v2-replay/run-five-year-single.sh "$1"
