#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${FINCOACH_PM2_APP:-fincoach}"
BASE_URL="${APP_BASE_URL:-http://127.0.0.1:5000}"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

section() {
  printf '\n== %s ==\n' "$1"
}

run_readonly() {
  local label="$1"
  shift
  printf '\n-- %s --\n' "$label"
  if ! "$@"; then
    printf 'WARN: %s failed\n' "$label"
  fi
}

redact_env_file() {
  node - "$1" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const path = process.argv[2];
const sensitive = /(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|ACCOUNT_ID|SIGNING_KEY)/i;
for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
  if (!line) continue;
  const index = line.indexOf("=");
  if (index < 0) {
    console.log(line);
    continue;
  }
  const key = line.slice(0, index);
  const value = line.slice(index + 1);
  if (key === "TELEGRAM_BOT_TOKEN" && value) {
    console.log(`${key}=sha256:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)}`);
  } else if (sensitive.test(key)) {
    console.log(`${key}=[REDACTED]`);
  } else {
    console.log(line);
  }
}
NODE
}

extract_json_document() {
  node - "$1" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const text = fs.readFileSync(path, "utf8");
const start = text.indexOf("{");
const end = text.lastIndexOf("}");
if (start < 0 || end < start) {
  process.exit(2);
}
const json = text.slice(start, end + 1);
JSON.parse(json);
process.stdout.write(json + "\n");
NODE
}

section "Revision"
run_readonly "git revision" git rev-parse HEAD
run_readonly "git status" git status --short --branch

section "PM2"
if command -v pm2 >/dev/null 2>&1; then
  run_readonly "pm2 status" pm2 status "$APP_NAME"
  PM2_JSON="$TMP_ROOT/pm2-jlist.json"
  if pm2 jlist > "$PM2_JSON"; then
    node - "$APP_NAME" "$PM2_JSON" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const appName = process.argv[2];
const path = process.argv[3];
const apps = JSON.parse(fs.readFileSync(path, "utf8"));
for (const app of apps.filter((item) => item.name === appName)) {
  const env = app.pm2_env || {};
  const token = env.TELEGRAM_BOT_TOKEN || "";
  console.log(JSON.stringify({
    name: app.name,
    pid: app.pid,
    status: env.status,
    cwd: env.pm_cwd,
    exec: env.pm_exec_path,
    args: env.args,
    telegramTransport: env.FINCOACH_TELEGRAM_TRANSPORT || null,
    telegramNotificationsEnabled: env.TELEGRAM_NOTIFICATIONS_ENABLED || null,
    telegramBotTokenFingerprint: token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12) : null,
    safetyFlags: {
      FINCOACH_LIVE_EXECUTION_ENABLED: env.FINCOACH_LIVE_EXECUTION_ENABLED,
      FINCOACH_PAPER_EXECUTION_ENABLED: env.FINCOACH_PAPER_EXECUTION_ENABLED,
      FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: env.FINCOACH_DEMO_BROKER_EXECUTION_ENABLED,
      FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED
    }
  }, null, 2));
}
NODE
  fi
else
  printf 'WARN: pm2 not found\n'
fi

section "Host Processes"
run_readonly "FinCoach-like processes" bash -lc "ps -eo uid,pid,ppid,etime,cmd | grep -E '(FinCoach|fincoach|tsx server/index|dist/index\\.cjs|node .*server/index\\.ts)' | grep -v grep || true"

section "Docker"
if command -v docker >/dev/null 2>&1; then
  run_readonly "docker containers" docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  CONTAINERS="$TMP_ROOT/docker-containers.txt"
  docker ps -q > "$CONTAINERS" || true
  while read -r id; do
    [[ -n "$id" ]] || continue
    printf '\n-- docker inspect %s --\n' "$id"
    docker inspect "$id" --format 'name={{.Name}} image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_service={{index .Config.Labels "com.docker.compose.service"}}' || true
    ENV_FILE="$TMP_ROOT/docker-$id.env"
    docker inspect "$id" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENV_FILE" || true
    grep -E '^(FINCOACH_|TELEGRAM_|NODE_ENV=|APP_BASE_URL=)' "$ENV_FILE" > "$ENV_FILE.filtered" || true
    redact_env_file "$ENV_FILE.filtered" || true
    if docker inspect "$id" --format '{{range .Config.Env}}{{println .}}{{end}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}' \
      | grep -Eq '(/app|tsx server/index|dist/index\.cjs|FinCoach|fincoach)'; then
      printf 'SUSPECT: container may be a FinCoach runtime. Inspect before restarting PM2.\n'
    fi
  done < "$CONTAINERS"
else
  printf 'WARN: docker not found\n'
fi

section "Execution Safety Flags"
env | grep -E '^(FINCOACH_LIVE_EXECUTION_ENABLED|FINCOACH_PAPER_EXECUTION_ENABLED|FINCOACH_DEMO_BROKER_EXECUTION_ENABLED|FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED)=' | sort || true

section "Migrations"
if [[ -n "${DATABASE_URL:-}" ]]; then
  STATUS_RAW="$TMP_ROOT/migration-status.raw"
  if npm run db:migrate:status > "$STATUS_RAW"; then
    extract_json_document "$STATUS_RAW" || cat "$STATUS_RAW"
  else
    cat "$STATUS_RAW"
    printf 'WARN: migration status failed\n'
  fi
  run_readonly "migration verify" npm run db:migrate:verify
else
  printf 'WARN: DATABASE_URL is not set; skipping migration checks\n'
fi

section "auth_sessions Schema"
if [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns WHERE table_name = 'auth_sessions' ORDER BY ordinal_position; SELECT constraint_type || ':' || constraint_name FROM information_schema.table_constraints WHERE table_name = 'auth_sessions' ORDER BY constraint_type, constraint_name; SELECT indexname FROM pg_indexes WHERE tablename = 'auth_sessions' ORDER BY indexname;" || true
else
  printf 'WARN: DATABASE_URL or psql unavailable; skipping auth_sessions schema check\n'
fi

section "Application Health"
if command -v curl >/dev/null 2>&1; then
  run_readonly "GET /api/health" curl -fsS "$BASE_URL/api/health"
else
  printf 'WARN: curl not found\n'
fi

section "Recent Logs"
PATTERN='Telegram getUpdates failed with HTTP 409|telegram_polling_conflict|ENOENT.*table\.sql|ERR_HTTP_HEADERS_SENT|auth_session_store_error|unhandled_rejection'
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs "$APP_NAME" --lines 300 --nostream 2>/dev/null | grep -E "$PATTERN" || true
fi
if [[ -d logs ]]; then
  grep -RIE "$PATTERN" logs 2>/dev/null | tail -n 100 || true
fi

section "Result Guidance"
cat <<'EOF'
This script is read-only. It does not stop containers, restart PM2, run migrations, or modify .env.
If a Docker container is marked SUSPECT, identify ownership, image, restart policy, compose service,
Telegram token fingerprint, and polling configuration before restarting the PM2 fincoach runtime.
EOF
