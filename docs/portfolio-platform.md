# Portfolio Research & Management Platform

## Boundary

Portfolio is an independent FinCoach subsystem under `server/portfolio`. It does not require FX/V2 runtime composition and must remain independently disableable with `FINCOACH_PORTFOLIO_ENABLED=false`.

Shared infrastructure is limited to PostgreSQL, authentication, HTTP routing, structured logging, and operational blocker reporting. Portfolio provider failures should degrade Portfolio health only; they must not crash FX/V2.

## Authentication

The web app is private by default. `FINCOACH_AUTH_REQUIRED=true` protects private `/api/*` routes and the frontend. Public exceptions are health, auth, Telegram webhook, and TradingView webhook routes.

Allowed users are managed server-side through `FINCOACH_AUTH_ALLOWED_EMAILS`. Emails are normalized to lowercase. Non-whitelisted signups and signins receive generic failures.

Production must set `FINCOACH_AUTH_SESSION_SECRET`. Passwords are hashed server-side with PBKDF2 and are never logged.

## Portfolio Configuration

Required deployment additions:

- `FINCOACH_AUTH_ALLOWED_EMAILS=<operator emails>`
- `FINCOACH_AUTH_SESSION_SECRET=<strong random secret>`
- `FINCOACH_PORTFOLIO_ENABLED=true` only when the operator wants Portfolio online
- `FINCOACH_PORTFOLIO_STARTING_CAPITAL=100000`
- `FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED=false`

Safe defaults leave Portfolio disabled and live execution blocked.

## Starting Capital

`FINCOACH_PORTFOLIO_STARTING_CAPITAL` applies only to newly created portfolios. Each portfolio persists its own `starting_capital`, so future env changes do not rewrite historical accounting.

## Strategy Set

Bootstrap creates 20 independent virtual portfolios spanning capital preservation through maximum-risk experimental mandates. Each has its own strategy row, portfolio cash, positions, NAV history, decision journal, benchmark symbol, risk level, and lifecycle state.

## Market Data

The provider abstraction supports multiple asset classes. The first implementation supports:

- `none`: production-safe unavailable provider that records blockers instead of inventing prices.
- `fixture`: deterministic test/development provider. It is marked as fixture/non-live and should not be used as live market evidence.

No live equity/ETF/options prices are fabricated. Unsupported instruments are reported as unavailable/degraded.

## Virtual Broker And Accounting

Portfolio rebalances are virtual-capital actions only. The service uses observed provider quotes, conservative spread/fee assumptions, persisted cash, persisted positions, NAV history, and idempotent hourly NAV snapshots.

Daily display uses a UTC day boundary. Weekend summaries freeze daily change at zero while preserving Friday NAV semantics until mixed asset calendars are modeled in detail.

## Live Execution Safety

`FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED=true` is rejected at configuration/service construction time. No current API promotes or submits real-money Portfolio orders. The lifecycle includes `LIVE_CANDIDATE` and `CONTROLLED_LIVE` as future states, but automated promotion into real money is not implemented.

Existing FX safety gates are unchanged.

## Operations

Portfolio health is exposed at:

- `GET /api/portfolio/health`
- process health includes `subsystems.portfolio`

Portfolio routes are authenticated:

- `GET /api/portfolio/summary`
- `GET /api/portfolio/strategies/:portfolioId`
- `GET /api/portfolio/activity`
- `POST /api/portfolio/strategies/:portfolioId/rebalance`

Config and provider blockers are recorded through the canonical operational blocker service. Telegram delivery uses existing dedupe/reminder behavior when operator notification configuration is enabled.

## Database

Migration `0020_auth_and_portfolio_platform.sql` is additive and creates:

- `auth_users`
- `portfolio_strategies`
- `portfolios`
- `portfolio_positions`
- `portfolio_transactions`
- `portfolio_nav_history`
- `portfolio_decision_journal`
- `portfolio_rankings`

The migration uses idempotent `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements inside a transaction. It does not update, delete, truncate, or destructively rewrite existing rows.

## Deployment

Safe sequence:

```bash
npm run db:backup
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:verify
npm ci
npm run check
npm test
npm run build
pm2 restart fincoach
```

Read-only verification:

```bash
curl -s http://127.0.0.1:5000/api/health
curl -s -b /tmp/fincoach.cookies -c /tmp/fincoach.cookies http://127.0.0.1:5000/api/auth/session
npm run db:migrate:status
```

Authenticated Portfolio verification requires a whitelisted operator session.
