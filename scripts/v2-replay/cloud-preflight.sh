#!/usr/bin/env bash
set -euo pipefail

EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
DATASET_MANIFEST="${DATASET_MANIFEST:-}"
OUTPUT_DIR="${OUTPUT_DIR:-artifacts/v2-replay/preflight}"
MIN_FREE_DISK_GB="${FINCOACH_REPLAY_MIN_FREE_DISK_GB:-1}"
MIN_MEMORY_GB="${FINCOACH_REPLAY_MIN_MEMORY_GB:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-commit) EXPECTED_COMMIT="$2"; shift 2 ;;
    --dataset-manifest) DATASET_MANIFEST="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --min-free-disk-gb) MIN_FREE_DISK_GB="$2"; shift 2 ;;
    --min-memory-gb) MIN_MEMORY_GB="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

commit="$(git rev-parse HEAD)"
if [[ -n "$EXPECTED_COMMIT" && "$commit" != "$EXPECTED_COMMIT"* ]]; then echo "unexpected commit: $commit" >&2; exit 1; fi
if [[ -z "${PACKAGED_DEPLOYMENT:-}" && -n "$(git status --short)" ]]; then echo "working tree is not clean" >&2; exit 1; fi
node --version >/dev/null
npm --version >/dev/null
node -e 'const scripts=require("./package.json").scripts||{}; for (const name of ["v2:replay:prepare","v2:replay:run","v2:replay:validate"]) if (!scripts[name]) process.exit(1)'
test "${FINCOACH_LIVE_EXECUTION:-blocked}" != "enabled" || { echo "live execution enabled" >&2; exit 1; }
test "${BROKER_EXECUTION_ENABLED:-false}" != "true" || { echo "broker execution enabled" >&2; exit 1; }
test "${TELEGRAM_DELIVERY_ENABLED:-false}" != "true" || { echo "telegram delivery enabled" >&2; exit 1; }
test "${EXTERNAL_SIGNAL_PUBLICATION_ENABLED:-false}" != "true" || { echo "external signal publication enabled" >&2; exit 1; }
test -n "${DATABASE_URL:-}" || { echo "DATABASE_URL missing" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
test -w "$OUTPUT_DIR" || { echo "output directory not writable" >&2; exit 1; }
free_disk_gb="$(df -BG "$OUTPUT_DIR" | awk 'NR==2 { gsub(/G/, "", $4); print $4 }')"
if (( free_disk_gb < MIN_FREE_DISK_GB )); then echo "insufficient free disk: ${free_disk_gb}GB < ${MIN_FREE_DISK_GB}GB" >&2; exit 1; fi
memory_gb="$(awk '/MemAvailable/ { printf "%d", $2/1024/1024 }' /proc/meminfo)"
if (( memory_gb < MIN_MEMORY_GB )); then echo "insufficient memory: ${memory_gb}GB < ${MIN_MEMORY_GB}GB" >&2; exit 1; fi
if [[ -n "$DATASET_MANIFEST" ]]; then
  test -f "$DATASET_MANIFEST" || { echo "dataset manifest missing" >&2; exit 1; }
  npx tsx scripts/v2-replay/validate-dataset-manifest.ts --dataset-manifest "$DATASET_MANIFEST" >/dev/null
fi
git check-ignore "$OUTPUT_DIR/probe" >/dev/null 2>&1 || [[ "$OUTPUT_DIR" = /* ]] || { echo "output directory is not ignored by Git" >&2; exit 1; }
echo "cloud_preflight_ready"
