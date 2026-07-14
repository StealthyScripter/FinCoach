#!/usr/bin/env bash
set -euo pipefail
npm run v2:replay:compare -- --left "${1:?left summary required}" --right "${2:?right summary required}"
