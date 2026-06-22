# Telegram Control and Connector Safety

This area is security-sensitive.

If a Telegram bot token was ever exposed, rotate it before deployment.

If you have already pasted a Telegram token anywhere outside `.env`, rotate it immediately and treat it as compromised.

Use environment variables only:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_URL`

Recommended connector-related environment variables:

- `OANDA_API_TOKEN`
- `OANDA_ACCOUNT_ID`
- `OANDA_ENV=practice`
- `METATRADER_DEMO_BRIDGE_URL`
- `TRADINGVIEW_WEBHOOK_SECRET`
- `GENERIC_REST_BROKER_BASE_URL`

Rules:

- Never commit Telegram tokens or webhook secrets.
- Never paste tokens into source code.
- Never log tokens, webhook secrets, or broker credentials.
- Redact bot tokens from logs, audit exports, and diagnostics.
- Redact webhook signatures and account IDs where they appear in logs or reports.
- Only the configured Telegram user ID may control the bot.
- Reject group and channel updates unless explicitly enabled.
- Verify the webhook secret header on every webhook request.
- Rate limit Telegram commands.
- Require confirmation for dangerous actions.
- Keep the kill switch as the final override.

Operational defaults:

- Telegram control is disabled unless the environment is configured.
- Production live execution remains disabled by default.
- Broker and platform connectors default to disabled unless explicitly enabled.
- Paid providers remain optional and off by default.

Command groups:

- View: `/status`, `/portfolio`, `/positions`, `/strategies`, `/signals`, `/watchlist`, `/journal`, `/risk`, `/system`
- Research: `/explain SYMBOL`, `/why SYMBOL`, `/strategy SYMBOL`
- Strategy: `/start_strategy`, `/stop_strategy`, `/track_trade`
- Paper/Sandbox: `/enable_paper`, `/enable_sandbox`, `/close_paper`, `/close_sandbox`, `/daily`, `/weekly`, `/debrief`
- Safety: `/kill`, `/disable_automation`, `/unfreeze`, `/autonomy`
- Learning: `/lessons`
- System: `/help`, `/system`

Confirmation is required for:

- `/enable_paper`
- `/enable_sandbox`
- `/start_strategy`
- `/stop_strategy`
- `/close_paper`
- `/close_sandbox`
- `/disable_automation`
- `/unfreeze`
- `/autonomy`

Inline buttons mirror the same commands. Safe buttons trigger read-only views. Risky buttons start a confirmation flow and must be confirmed with `CONFIRM <code>` or cancelled with `CANCEL <code>`.

The `/help` response also states that live production trading remains disabled by default.

Connector strategy:

- Prefer internal calculations first.
- Prefer free or demo providers next.
- Use paid providers only if they are explicitly enabled and justified.

Connector matrix:

- Provider name
- Connector type
- Environment label
- Cost level
- Supported assets
- Supported actions
- Disabled actions
- Safety constraints
- Health
- Last sync
- Required env vars
- Missing env vars

The System page shows a compact summary and hides the rest behind expandable connector cards.

For the 7-day demo observation flow, see `docs/demo-run-reliability-test.md`.

Webhook setup:

- `POST /api/telegram/set-webhook` is admin/dev-only.
- The webhook call uses `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET`.
- Telegram webhook requests must include `X-Telegram-Bot-Api-Secret-Token`.
- Only the configured `TELEGRAM_ALLOWED_USER_ID` may control the bot.

Security model:

- Telegram commands are audited.
- Risky commands require confirmation.
- `/kill` and emergency freeze remain the highest-priority override paths.
- Production live order placement stays disabled by default.
