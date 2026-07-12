# Telegram Operations

FinCoach uses Telegram as an operations and reporting surface for `@WendotFinanceBot`.

FinCoach remains demo-only, paper-only, sandbox-only, and OANDA-practice-only. Telegram commands can report status and can request limited demo controls, but they cannot enable live trading, connect live accounts, override account verification, or bypass signal validation.

## Configuration

Required for operations notifications:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_NOTIFICATIONS_ENABLED=true`

Required for commands:

- `TELEGRAM_ALLOWED_USER_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_URL`

Required for machine-consumable signals:

- `TELEGRAM_SIGNAL_CHAT_ID`
- `TELEGRAM_SIGNALS_ENABLED=true`

If `TELEGRAM_SIGNAL_CHAT_ID` is missing, signal delivery fails closed. Signals are not silently sent to the operations chat.

## Commands

Read-only:

- `/status`
- `/health`
- `/demo_status`
- `/pipeline_status`
- `/providers`
- `/open_trades`
- `/exposure`
- `/today`
- `/week`
- `/strategies`
- `/kill_status`
- `/help`

Confirmation-required:

- `/pause_demo`
- `/resume_demo`
- `/disable_automation`
- `/kill`

Unsupported live-trading commands are blocked and audited.

## Reports

Daily summaries run at `TELEGRAM_DAILY_SUMMARY_HOUR_UTC`.

Weekly summaries run on `TELEGRAM_WEEKLY_SUMMARY_DAY` at `TELEGRAM_WEEKLY_SUMMARY_HOUR_UTC`.

Reports are persisted in PostgreSQL and concise versions are sent to `TELEGRAM_CHAT_ID`.

## Alerts

The notification layer supports:

- startup, graceful stop, crash/recovery, heartbeat
- health degradation
- demo run state
- research pipeline state
- market session transitions
- kill-switch and safety events
- open trades and exposure
- daily and weekly summaries
- signal lifecycle updates

Critical kill-switch alerts bypass digest behavior.

## PM2/systemd Behavior

The app records periodic lifecycle heartbeats. On startup, if the previous heartbeat was not marked as a clean shutdown, FinCoach sends a recovery notification with the last heartbeat and estimated downtime.

Hard crashes cannot reliably send a final message; recovery detection is the durable fallback.

## Scheduling

Scheduling is process-local because the current deployment uses one PM2 instance. Multi-instance deployments require PostgreSQL advisory locks or a job lease before enabling more than one scheduler process.
