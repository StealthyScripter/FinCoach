# Telegram Operations

FinCoach uses Telegram as an operations and reporting surface for `@WendotFinanceBot`.

FinCoach remains demo-only, paper-only, sandbox-only, and OANDA-practice-only. Telegram commands can report status and can request limited demo controls, but they cannot enable live trading, connect live accounts, override account verification, or bypass signal validation.

## Operator Alert Policy

Telegram operations alerts are reserved for operational incidents: configuration failure, authentication failure, provider failure, market-data failure/fallback, broker reconciliation failure, broker state mismatch, execution infrastructure failure, safety-environment failure, and system-health failure. Expected strategy, scientific, and risk-policy rejections remain persisted in database telemetry and summaries but do not send one Telegram message per rejection.

Set `FINCOACH_OPERATOR_ALERT_REPEAT_INTERVAL_MS=3600000` for hourly reminders while the same incident remains unresolved. Incidents are keyed by category, code, provider/broker, symbol when relevant, account/environment, and config key. The first occurrence sends immediately, repeated occurrences increment silently until the repeat interval, and resolution sends one recovery notification.

Inbound command polling is controlled separately from outbound Telegram delivery. Setting it to disabled prevents the `getUpdates` polling loop but does not disable outbound operator alerts when `TELEGRAM_NOTIFICATIONS_ENABLED=true`, `FINCOACH_TELEGRAM_BOT_TOKEN`, and `FINCOACH_TELEGRAM_CHAT_ID` are configured.

`getUpdates` polling fails closed. It starts only when all of these are explicitly set:

- `FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_INBOUND_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_LONG_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_TRANSPORT=long_polling`

Development and release-test environments must keep command polling, inbound polling, long polling, and webhook intake disabled.

## Configuration

Required for operations notifications:

- `FINCOACH_TELEGRAM_BOT_TOKEN`
- `FINCOACH_TELEGRAM_CHAT_ID`
- `TELEGRAM_NOTIFICATIONS_ENABLED=true`

Required for commands:

- `FINCOACH_TELEGRAM_ALLOWED_USER_ID`
- `FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_INBOUND_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_LONG_POLLING_ENABLED=true`
- `FINCOACH_TELEGRAM_TRANSPORT=long_polling`
- `FINCOACH_TELEGRAM_WEBHOOK_SECRET`
- `FINCOACH_TELEGRAM_WEBHOOK_URL`

Required for machine-consumable signals:

- `FINCOACH_TELEGRAM_SIGNAL_CHAT_ID`
- `TELEGRAM_SIGNALS_ENABLED=true`

If `FINCOACH_TELEGRAM_SIGNAL_CHAT_ID` is missing, signal delivery fails closed. Signals are not silently sent to the operations chat.

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
- `/open_exchanges`, `/markets_open`, `/market_status`
- `/market_snapshot`, `/snapshot`
- `/morning_snapshot`, `/evening_snapshot`
- `/upcoming_events`, `/market_events`
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

Reports are persisted in PostgreSQL and concise versions are sent to `FINCOACH_TELEGRAM_CHAT_ID`.

## Alerts

The notification layer supports:

- startup, graceful stop, crash/recovery, heartbeat
- health degradation
- demo run state
- research pipeline state
- market session transitions
- consolidated weekly tradable-window open and final-close notifications
- twice-daily market snapshots at 8:00 AM and 8:00 PM `America/New_York`
- kill-switch and safety events
- open trades and exposure
- daily and weekly summaries
- signal lifecycle updates

Critical kill-switch alerts bypass digest behavior.

Individual exchange/session open-close Telegram noise is suppressed. Calendar tracking still runs, but Telegram receives one consolidated weekly open notification and one consolidated final weekly close notification keyed by the aggregate configured tradable boundary.

Market snapshots are execution-oriented but non-prescriptive. They distinguish fresh, delayed, stale, and unavailable data. Missing live prices, yields, breadth, volatility, news, or consensus values are stated as unavailable rather than replaced with fixtures. Event impact scores are deterministic, bounded from 1 through 10, and include component scores in persisted snapshot payloads.

Example commands:

```text
/open_exchanges
/market_snapshot
/upcoming_events
```

Snapshot delivery is idempotent by `market-snapshot:<America/New_York date>:morning` and `market-snapshot:<America/New_York date>:evening`. Manual commands retrieve or generate snapshots without forcing scheduled duplicate delivery.

## PM2/systemd Behavior

The app records periodic lifecycle heartbeats. On startup, if the previous heartbeat was not marked as a clean shutdown, FinCoach sends a recovery notification with the last heartbeat and estimated downtime.

Hard crashes cannot reliably send a final message; recovery detection is the durable fallback.

## Scheduling

Scheduling is process-local because the current deployment uses one PM2 instance. Multi-instance deployments require PostgreSQL advisory locks or a job lease before enabling more than one scheduler process.
