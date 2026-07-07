# Strategy Machine Demo-Only Policy

Live trading is impossible by design.

- OANDA must be `practice`.
- MetaTrader must be `demo`.
- TradingView can create signals only.
- Telegram cannot bypass policy.
- Confirmation cannot override policy.
- Kill switch blocks everything.
- Unknown and unverified account modes fail closed.

Every strategy-machine execution decision routes through `DemoOnlyPolicyService` or the demo-execution module wrapper.
