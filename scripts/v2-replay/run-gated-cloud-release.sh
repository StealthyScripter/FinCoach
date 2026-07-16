#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/v2-replay/run-gated-cloud-release.sh <stage> [args]

Stages:
  backup                 --output-dir <dir>
  backup-verify          --backup <dump> --checksum <sha256>
  migration-status
  migration-baseline     --backup <dump> --checksum <sha256> [--all-equivalent]
  migration-apply        --backup <dump> --checksum <sha256>
  migration-verify
  dataset-build          --config <env-file>
  dataset-validate       --dataset-manifest <path>
  preflight              --expected-commit <commit> --dataset-manifest <path> --output <dir> --min-free-disk-gb <gb> --min-memory-gb <gb> --backup <dump> --checksum <sha256>
  verify                 --output <dir>
  five-year-single       --config <env-file>
  five-year-repeat       --config <env-file>
  five-year-compare      --left <summary.json> --right <summary.json>
  five-year-multi        --config <env-file>
  restart-campaign       --config <env-file>
  ten-year-single        --config <env-file>
  ten-year-repeat        --config <env-file>
  ten-year-compare       --left <summary.json> --right <summary.json>
  ten-year-multi         --config <env-file>
  finalize               --output <dir>

Options:
  --dry-run              Print commands without executing them.
  --help                 Show this help.

Each invocation runs one gate. The operator must invoke the next gate explicitly after
reviewing artifacts. The script never enables broker, Telegram, or external signal effects.
USAGE
}

stage="${1:-}"
if [[ -z "$stage" || "$stage" == "--help" || "$stage" == "-h" ]]; then
  usage
  exit 0
fi
shift

DRY_RUN=0
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) args+=("$1"); shift ;;
  esac
done
set -- "${args[@]}"

trap 'echo "gated cloud release failed at stage: '"$stage"'" >&2' ERR
trap 'echo "gated cloud release interrupted at stage: '"$stage"'; artifacts are preserved" >&2' TERM INT

export FINCOACH_LIVE_EXECUTION="${FINCOACH_LIVE_EXECUTION:-blocked}"
export BROKER_EXECUTION_ENABLED="${BROKER_EXECUTION_ENABLED:-false}"
export TELEGRAM_DELIVERY_ENABLED="${TELEGRAM_DELIVERY_ENABLED:-false}"
export EXTERNAL_SIGNAL_PUBLICATION_ENABLED="${EXTERNAL_SIGNAL_PUBLICATION_ENABLED:-false}"

reject_external_effects() {
  [[ "${FINCOACH_LIVE_EXECUTION:-blocked}" != "enabled" ]] || { echo "live execution enabled" >&2; exit 1; }
  [[ "${BROKER_EXECUTION_ENABLED:-false}" != "true" ]] || { echo "broker execution enabled" >&2; exit 1; }
  [[ "${TELEGRAM_DELIVERY_ENABLED:-false}" != "true" ]] || { echo "telegram delivery enabled" >&2; exit 1; }
  [[ "${EXTERNAL_SIGNAL_PUBLICATION_ENABLED:-false}" != "true" ]] || { echo "external signal publication enabled" >&2; exit 1; }
}

required_arg() {
  local name="$1"
  shift
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "$name" ]]; then
      [[ $# -ge 2 && -n "$2" ]] || { echo "$name requires a value" >&2; exit 2; }
      printf '%s\n' "$2"
      return 0
    fi
    shift
  done
  echo "$name is required for stage $stage" >&2
  exit 2
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY_RUN'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

run_env() {
  local key="$1"
  local value="$2"
  shift 2
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY_RUN %q=%q' "$key" "$value"
    printf ' %q' "$@"
    printf '\n'
  else
    env "$key=$value" "$@"
  fi
}

reject_external_effects

case "$stage" in
  preflight)
    expected_commit="$(required_arg --expected-commit "$@")"
    dataset_manifest="$(required_arg --dataset-manifest "$@")"
    output="$(required_arg --output "$@")"
    min_disk="$(required_arg --min-free-disk-gb "$@")"
    min_memory="$(required_arg --min-memory-gb "$@")"
    backup="$(required_arg --backup "$@")"
    checksum="$(required_arg --checksum "$@")"
    run bash scripts/v2-replay/cloud-preflight.sh --expected-commit "$expected_commit" --dataset-manifest "$dataset_manifest" --output "$output" --min-free-disk-gb "$min_disk" --min-memory-gb "$min_memory" --backup "$backup" --checksum "$checksum"
    ;;
  backup)
    output_dir="$(required_arg --output-dir "$@")"
    run_env FINCOACH_DB_BACKUP_DIR "$output_dir" npm run db:backup
    ;;
  backup-verify)
    backup="$(required_arg --backup "$@")"
    checksum="$(required_arg --checksum "$@")"
    run npm run db:restore:verify -- --backup "$backup" --checksum "$checksum"
    ;;
  migration-status)
    run npm run db:migrate:status
    ;;
  migration-baseline)
    backup="$(required_arg --backup "$@")"
    checksum="$(required_arg --checksum "$@")"
    if [[ "$DRY_RUN" == "1" ]]; then
      printf 'DRY_RUN npm run db:migrate:baseline -- --all-equivalent --backup %q --checksum %q\n' "$backup" "$checksum"
    else
      npm run db:migrate:baseline -- --all-equivalent --backup "$backup" --checksum "$checksum"
    fi
    ;;
  migration-apply)
    backup="$(required_arg --backup "$@")"
    checksum="$(required_arg --checksum "$@")"
    if [[ "$DRY_RUN" == "1" ]]; then
      printf 'DRY_RUN FINCOACH_DB_BACKUP_PATH=%q FINCOACH_DB_BACKUP_SHA256_PATH=%q npm run db:migrate\n' "$backup" "$checksum"
    else
      FINCOACH_DB_BACKUP_PATH="$backup" FINCOACH_DB_BACKUP_SHA256_PATH="$checksum" npm run db:migrate
    fi
    ;;
  migration-verify)
    run npm run db:migrate:verify
    ;;
  dataset-build)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/build-oanda-dataset.sh --load-env --config "$config"
    ;;
  dataset-validate)
    dataset_manifest="$(required_arg --dataset-manifest "$@")"
    run npm run v2:dataset:validate -- --manifest "$dataset_manifest"
    ;;
  verify)
    output="$(required_arg --output "$@")"
    run_env OUTPUT_DIR "$output" bash scripts/v2-replay/run-cloud-verify.sh
    ;;
  five-year-single|five-year-repeat)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/run-five-year-single.sh "$config"
    ;;
  five-year-compare|ten-year-compare)
    left="$(required_arg --left "$@")"
    right="$(required_arg --right "$@")"
    run bash scripts/v2-replay/compare-campaign-runs.sh "$left" "$right"
    ;;
  five-year-multi)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/run-five-year-multi.sh "$config"
    ;;
  restart-campaign)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/run-restart-campaign.sh "$config"
    ;;
  ten-year-single|ten-year-repeat)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/run-ten-year-single.sh "$config"
    ;;
  ten-year-multi)
    config="$(required_arg --config "$@")"
    run bash scripts/v2-replay/run-ten-year-multi.sh "$config"
    ;;
  finalize)
    output="$(required_arg --output "$@")"
    run npm run v2:replay:validate -- --output "$output"
    run npm run v2:replay:report -- "$output/summary.json"
    ;;
  *)
    echo "unknown stage: $stage" >&2
    usage >&2
    exit 2
    ;;
esac

echo "gated cloud release stage passed: $stage"
