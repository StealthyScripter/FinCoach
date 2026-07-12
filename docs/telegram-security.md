# Telegram Security

## Secret Handling

Never log, print, return, expose, or commit:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SIGNAL_SIGNING_SECRET`
- OANDA tokens
- OANDA account IDs
- database credentials
- API keys

Status outputs redact chat IDs and only report whether secrets are configured.

## Authorization

Only `TELEGRAM_ALLOWED_USER_ID` may invoke commands.

Unauthorized attempts are rejected and audited in `telegram_command_audit`.

## Demo-Only Enforcement

Telegram cannot:

- enable live trading
- connect live accounts
- disable demo-only mode
- override account verification
- bypass signal validation
- place live-money orders

Any live-trading command language is blocked and recorded through the demo-only policy.

## Signals

Signals are suppressed when:

- required fields are missing
- market data is stale
- kill switch is active
- provider health is unacceptable
- market/session rules block entry
- confidence or evidence score is too low
- duplicate fingerprint exists
- cooldown has not expired
- event lineage is incomplete

Publishing a signal does not imply guaranteed profitability.

## HMAC

Use a dedicated `TELEGRAM_SIGNAL_SIGNING_SECRET` for signal authenticity. Never reuse the Telegram bot token.

Consumers should canonicalize the signal fields and verify `HMAC-SHA256` before acting on messages.

## Webhook Verification

Webhook requests must include:

```text
X-Telegram-Bot-Api-Secret-Token
```

Requests with missing or incorrect secrets fail closed.
