# OANDA Practice Setup

OANDA may be used only in practice mode.

Required local environment:

- `OANDA_ENV=practice`
- `OANDA_API_TOKEN`
- `OANDA_ACCOUNT_ID`

Never commit `.env` or account credentials. Any non-practice OANDA mode is blocked by `DemoOnlyPolicyService`.

The strategy-machine tests use mocked data by default. A real practice trade should only be placed when credentials, account mode, instrument, position size, risk settings, and audit logging are all explicitly verified.
