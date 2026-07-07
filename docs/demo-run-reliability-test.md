# MarketPilot 7-Day Demo Run

This run mode is for paper, sandbox, demo, and practice accounts only.
MarketPilot is demo-only. Live account execution is disabled by policy and cannot be enabled from UI, Telegram, confirmation flows, or live-like environment flags.

## Setup

Copy the environment variables into `FinCoach/.env` and keep secrets out of source control.

Required variables:

- `MARKETPILOT_RUN_MODE=demo_observation`
- `PORT=`
- `NODE_ENV=`
- `APP_BASE_URL=`
- `DATABASE_URL=`
- `TELEGRAM_BOT_TOKEN=`
- `TELEGRAM_ALLOWED_USER_ID=`
- `TELEGRAM_WEBHOOK_SECRET=`
- `TELEGRAM_WEBHOOK_URL=`
- `OPENAI_API_KEY=`
- `OPENAI_MODEL=`
- `OANDA_API_TOKEN=`
- `OANDA_ACCOUNT_ID=`
- `OANDA_ENV=practice`
- `METATRADER_BRIDGE_URL=`
- `METATRADER_BRIDGE_SECRET=`
- `TRADINGVIEW_WEBHOOK_SECRET=`
- `FRED_API_KEY=`
- `QDRANT_URL=`

Rotate any Telegram bot token that was exposed before deployment.
Never commit tokens, account IDs, webhook secrets, or API keys.

## Run mode

`MARKETPILOT_RUN_MODE=demo_observation` enables the demo observation flow:

- live account execution stays blocked
- paper automation remains allowed
- sandbox/demo broker flows remain allowed
- OANDA practice remains allowed
- Telegram control is limited to the configured user ID
- auto-adjustments are risk-reducing only

## Endpoints

- `GET /api/marketpilot/demo-run/status`
- `GET /api/marketpilot/demo-run/telemetry`
- `GET /api/marketpilot/demo-run/report`
- `GET /api/marketpilot/demo-run/export`

Control endpoints:

- `POST /api/marketpilot/demo-run/start`
- `POST /api/marketpilot/demo-run/pause`
- `POST /api/marketpilot/demo-run/resume`
- `POST /api/marketpilot/demo-run/stop`
- `POST /api/marketpilot/demo-run/screen-visit`

## Telegram commands

View and reporting:

- `/demo_status`
- `/demo_report`
- `/demo_export`
- `/demo_adjustments`
- `/demo_risks`

Control:

- `/demo_start` — confirmation required
- `/demo_pause`
- `/demo_resume` — confirmation required
- `/demo_stop` — confirmation required

## Telemetry captured

The demo run aggregates:

- reliability
- safety
- usability
- calibration
- trading performance
- daily evaluation reports
- adjustment history

## Auto-adjustments

Risk-reducing changes may be applied automatically in demo mode:

- pause weak strategies
- disable retiring strategies
- reduce paper risk per trade
- tighten max trades per day

Not allowed automatically:

- increasing risk
- increasing leverage
- live account control
- credential changes
- withdrawals or transfers
- disabling kill switches
- bypassing confirmations

Every adjustment is recorded in the event log and audit log with before/after state.

## Review cadence

At the end of each day, review:

- reliability score
- safety score
- usability score
- calibration score
- strategy performance score
- top adjustments

After 7 days, review the final report and decide whether the system is ready for the next controlled test.
