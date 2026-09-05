#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:---all}"
IMAGE="${FINCOACH_TEST_POSTGRES_IMAGE:-postgres:16-alpine}"
RUN_ID="$(node -e 'console.log(require("crypto").randomBytes(8).toString("hex"))')"
CONTAINER="fincoach-test-postgres-${RUN_ID}"
DB_NAME="fincoach_disposable_test_${RUN_ID}"
DB_USER="fincoach_test_${RUN_ID}"
DB_PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
HOST_PORT=""
DB_URL=""
CLEANUP_DONE="NO"

cleanup() {
  local status=$?
  set +e
  if [[ -n "${CONTAINER:-}" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1
    if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      CLEANUP_DONE="NO"
    else
      CLEANUP_DONE="YES"
    fi
  fi
  printf 'production DB used: NO\n'
  printf 'disposable DB used: %s\n' "${DB_URL:+YES}"
  printf 'cleanup completed: %s\n' "$CLEANUP_DONE"
  exit "$status"
}
trap cleanup EXIT INT TERM

require_tool() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing prerequisite: %s\n' "$1" >&2
    exit 127
  }
}

require_tool docker
require_tool node
require_tool npm

if ! docker info >/dev/null 2>&1; then
  printf 'Docker is required and must be running for disposable PostgreSQL tests.\n' >&2
  exit 127
fi

unset DATABASE_URL TEST_DATABASE_URL PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
unset OANDA_API_TOKEN OANDA_ACCOUNT_ID OANDA_ACCOUNT_IDS OANDA_ENVIRONMENT OANDA_VALIDATION_ALLOW_EXTERNAL_TRADE
unset FINCOACH_TELEGRAM_BOT_TOKEN TELEGRAM_BOT_TOKEN FINCOACH_TELEGRAM_CHAT_ID TELEGRAM_CHAT_ID FINCOACH_TELEGRAM_ALLOWED_USER_ID
unset FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED TELEGRAM_NOTIFICATIONS_ENABLED TELEGRAM_SIGNALS_ENABLED
unset OPENAI_API_KEY ANTHROPIC_API_KEY FRED_API_KEY ALPACA_API_KEY POLYGON_API_KEY QDRANT_URL REDIS_URL

printf 'Starting disposable PostgreSQL container %s from %s\n' "$CONTAINER" "$IMAGE"
docker run -d --rm \
  --name "$CONTAINER" \
  -e "POSTGRES_DB=$DB_NAME" \
  -e "POSTGRES_USER=$DB_USER" \
  -e "POSTGRES_PASSWORD=$DB_PASSWORD" \
  -p "127.0.0.1::5432" \
  "$IMAGE" >/dev/null

HOST_PORT="$(docker port "$CONTAINER" 5432/tcp | sed -n 's/.*://p' | head -n 1)"
if [[ -z "$HOST_PORT" ]]; then
  printf 'Unable to determine disposable PostgreSQL port.\n' >&2
  exit 1
fi
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}"

printf 'Waiting for disposable PostgreSQL readiness on 127.0.0.1:%s\n' "$HOST_PORT"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

export DATABASE_URL="$DB_URL"
export TEST_DATABASE_URL="$DB_URL"
export FINCOACH_TEST_DB_DISPOSABLE="true"
export FINCOACH_TEST_DB_CONTAINER="$CONTAINER"
export FINCOACH_TEST_DB_HOST="127.0.0.1"
export FINCOACH_TEST_DB_PORT="$HOST_PORT"
export FINCOACH_ALLOW_DISPOSABLE_DB_MIGRATION_WITHOUT_BACKUP="true"
export FINCOACH_LIVE_EXECUTION_ENABLED="false"
export FINCOACH_PAPER_EXECUTION_ENABLED="false"
export FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED="false"
export FINCOACH_DEMO_BROKER_EXECUTION_ENABLED="true"
export OANDA_ENV="practice"
export OANDA_BASE_URL="https://api-fxpractice.oanda.com/v3"
export OANDA_API_TOKEN=""
export OANDA_ACCOUNT_ID=""
export FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED="false"
export TELEGRAM_NOTIFICATIONS_ENABLED="false"
export TELEGRAM_SIGNALS_ENABLED="false"

printf 'Applying full migration chain to disposable PostgreSQL\n'
npm run db:migrate
npm run db:migrate:verify
npm run db:migrate:status
npx tsx server/disposableTestDatabase.test.ts

case "$MODE" in
  --db-only)
    npx tsx server/pgStorage.integration.test.ts
    npx tsx server/authSessionPersistence.pg.test.ts
    npx tsx server/portfolioPostgresIntegration.test.ts
    npx tsx server/portfolioPlatform.pg.test.ts
    npx tsx server/telegramPollingPostgres.pg.test.ts
    npx tsx server/telegramWeeklySessionNotifications.pg.test.ts
    npx tsx server/telegramSchedulerFailureMatrix.test.ts
    npx tsx server/v2.durable-repositories.pg.test.ts
    npx tsx server/v2.evidence-repositories.pg.test.ts
    npx tsx server/v2.extended-pilot-readiness.test.ts
    npx tsx server/v2.observation-repository-parity.pg.test.ts
    npx tsx server/v2.operational-maturity.pg.test.ts
    npx tsx server/v2.operations-projections.pg.test.ts
    npx tsx server/v2.orchestration-discipline.pg.test.ts
    npx tsx server/v2.reporting-parity.pg.test.ts
    npx tsx server/v2.restart-recovery.pg.test.ts
    ;;
  --all)
    npm run test:deterministic
    ;;
  *)
    printf 'Usage: %s [--all|--db-only]\n' "$0" >&2
    exit 2
    ;;
esac

printf 'Disposable PostgreSQL validation completed successfully.\n'
