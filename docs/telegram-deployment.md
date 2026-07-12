# Telegram Deployment

## Bot Setup

1. Create or configure `@WendotFinanceBot` in BotFather.
2. Store the bot token in `.env` as `TELEGRAM_BOT_TOKEN`.
3. Do not print or commit `.env`.
4. Configure `TELEGRAM_CHAT_ID` for human operations alerts.
5. Configure `TELEGRAM_SIGNAL_CHAT_ID` for machine-consumable signals.
6. Configure `TELEGRAM_ALLOWED_USER_ID` for command authorization.

Signals fail closed if `TELEGRAM_SIGNAL_CHAT_ID` is missing.

## Webhook Mode

Set:

```env
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
```

Telegram sends webhook updates to:

```text
POST /api/telegram/webhook
```

The webhook secret must match `X-Telegram-Bot-Api-Secret-Token`.

## API Visibility

Operational endpoints:

- `GET /api/marketpilot/telegram/status`
- `GET /api/marketpilot/telegram/deliveries`
- `GET /api/marketpilot/telegram/signals`
- `GET /api/marketpilot/telegram/signals/:id`
- `POST /api/marketpilot/telegram/test`
- `POST /api/marketpilot/telegram/daily-summary`
- `POST /api/marketpilot/telegram/weekly-summary`
- `POST /api/marketpilot/telegram/signal-preview`

The test endpoint sends only an explicit test message. The preview endpoint never publishes.

## PostgreSQL

Run migrations through the existing deployment flow. Telegram persistence uses:

- `telegram_deliveries`
- `telegram_signals`
- `telegram_signal_updates`
- `telegram_summaries`
- `telegram_scheduler_runs`
- `telegram_command_audit`
- `telegram_lifecycle_state`

## PM2/systemd

The app sends startup notifications after boot and stores heartbeats. On restart after an unexpected stop, it sends a recovery notification.

## Verification

Run:

```bash
npm run check
npm run build
npm test
set -a; source .env; set +a; npm run test:pgstorage
git diff --check
```

Only run external Telegram integration tests when credentials and chat IDs are configured. Test signals must include `TEST ONLY — DO NOT EXECUTE`.
