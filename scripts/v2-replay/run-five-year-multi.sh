#!/usr/bin/env bash
set -euo pipefail
bash scripts/v2-replay/run-five-year-single.sh "${1:?campaign env file required}"
