# FinCoach Operator Production Deployment Checklist

Run these commands on the production server after the repaired commit is pushed.
Do not stop or remove any unidentified container until ownership and restart policy are known.

```bash
cd ~/docker/projects/FinCoach
git status --short --branch
git rev-parse HEAD
git fetch origin main
git log --oneline --decorate -5 --all
git pull --ff-only origin main
git rev-parse HEAD
```

```bash
npm install
```

Verify execution safety flags remain false:

```bash
set -a
source .env
set +a
printf '%s=%s\n' \
  FINCOACH_LIVE_EXECUTION_ENABLED "$FINCOACH_LIVE_EXECUTION_ENABLED" \
  FINCOACH_PAPER_EXECUTION_ENABLED "$FINCOACH_PAPER_EXECUTION_ENABLED" \
  FINCOACH_DEMO_BROKER_EXECUTION_ENABLED "$FINCOACH_DEMO_BROKER_EXECUTION_ENABLED" \
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED "$FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED"
```
Create and register a database backup before migration:

```bash
set -a
source .env
set +a
npm run db:backup
export FINCOACH_DB_BACKUP_PATH=/path/to/the/new/backup.dump
export FINCOACH_DB_BACKUP_SHA256_PATH=/path/to/the/new/backup.dump.sha256
```

Confirm migration status. Only the intended unreleased additive migrations, such as `0023_auth_sessions` and `0024_portfolio_market_data_cache`, should be pending before applying this repair:

```bash
npm run db:migrate:status
npm run db:migrate:verify || true
```

Apply and verify migrations:

```bash
npm run db:migrate
npm run db:migrate:status
npm run db:migrate:verify
```

Run checks, tests with isolated provider credentials, and build:

```bash
npm run check
env -u DATABASE_URL -u TEST_DATABASE_URL \
  -u TELEGRAM_BOT_TOKEN -u TELEGRAM_ALLOWED_USER_ID -u TELEGRAM_CHAT_ID -u TELEGRAM_SIGNAL_CHAT_ID \
  -u TELEGRAM_WEBHOOK_SECRET -u TELEGRAM_WEBHOOK_URL \
  -u OANDA_API_TOKEN -u OANDA_ACCOUNT_ID -u ALPHA_VANTAGE_API_KEY -u TWELVE_DATA_API_KEY -u FINCOACH_AUTH_SESSION_SECRET \
  NODE_ENV=test \
  FINCOACH_LIVE_EXECUTION_ENABLED=false \
  FINCOACH_PAPER_EXECUTION_ENABLED=false \
  FINCOACH_DEMO_BROKER_EXECUTION_ENABLED=false \
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED=false \
  FINCOACH_PORTFOLIO_ENABLED=true \
  FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=fixture \
  FINCOACH_PORTFOLIO_ALLOW_FIXTURE_PROVIDER=true \
  FINCOACH_TELEGRAM_INBOUND_POLLING_ENABLED=false \
  FINCOACH_TELEGRAM_POLL_LOCK_PATH="/tmp/fincoach-telegram-test-$$.lock" \
  npm test
npm run build
```

Before restarting PM2, investigate any duplicate Docker FinCoach runtime:

```bash
pm2 status fincoach
pm2 jlist > /tmp/fincoach-pm2-jlist.json
ps -eo uid,pid,ppid,etime,cmd | grep -E '(FinCoach|fincoach|tsx server/index|dist/index\.cjs|node .*server/index\.ts)' | grep -v grep
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker inspect <suspect_container_id> --format 'name={{.Name}} image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_service={{index .Config.Labels "com.docker.compose.service"}}'
docker inspect <suspect_container_id> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(FINCOACH_|TELEGRAM_|NODE_ENV=|APP_BASE_URL=)'
```

If a duplicate runtime is confirmed, disable the obsolete workload through its owning Compose/service configuration first. Do not repeatedly kill host PIDs.

Restart only the intended PM2 runtime:

```bash
pm2 restart fincoach --update-env
pm2 status fincoach
```

Run read-only verification:

```bash
bash scripts/verify-production-repair.sh
```

Verify auth signin/session manually without creating duplicate production users:

```bash
# Use the existing production operator account. Do not paste output into tickets or chat.
curl -sS -c /tmp/fincoach-auth.cookies -H 'content-type: application/json' \
  -d '{"email":"OPERATOR_EMAIL","password":"OPERATOR_PASSWORD"}' \
  http://127.0.0.1:5000/api/auth/signin
curl -sS -b /tmp/fincoach-auth.cookies http://127.0.0.1:5000/api/auth/session
rm -f /tmp/fincoach-auth.cookies
```

Verify Telegram, Portfolio, logs, and safety:

```bash
curl -sS http://127.0.0.1:5000/api/health
curl -sS http://127.0.0.1:5000/api/portfolio/health
pm2 logs fincoach --lines 300 --nostream | grep -E 'Telegram getUpdates failed with HTTP 409|telegram_polling_conflict|ENOENT.*table\.sql|ERR_HTTP_HEADERS_SENT|auth_session_store_error|unhandled_rejection' || true
printf '%s=%s\n' \
  FINCOACH_LIVE_EXECUTION_ENABLED "$FINCOACH_LIVE_EXECUTION_ENABLED" \
  FINCOACH_PAPER_EXECUTION_ENABLED "$FINCOACH_PAPER_EXECUTION_ENABLED" \
  FINCOACH_DEMO_BROKER_EXECUTION_ENABLED "$FINCOACH_DEMO_BROKER_EXECUTION_ENABLED" \
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED "$FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED"
```
