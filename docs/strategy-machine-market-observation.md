# Strategy Machine Market Observation

The market-data module observes markets only. It does not create trade signals, orders, or strategy decisions.

Supported instruments:

- Forex priority: `EUR_USD`, `GBP_USD`, `USD_JPY`
- Metals priority: `XAU_USD`, `XAG_USD`
- Stock demo fixtures: `AAPL`, `MSFT`, `TSLA`

Outputs:

- `MarketSnapshotCreated`
- `CandleSeriesCreated`
- `SessionContextCreated`
- `VolatilityStateDetected`
- `SpreadStateDetected`
- `EconomicContextAttached`

OANDA pricing may be wired as a provider only when `OANDA_ENV=practice`. If credentials are not configured, tests use deterministic mock inputs and no external request is made.
