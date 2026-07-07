# Strategy Machine Backtesting

Backtesting simulates objective rule sets with deterministic spread, slippage, commission, and risk assumptions. It reports R-multiple metrics, drawdown, symbol/timeframe/session/regime breakdowns, and insufficient sample events.

The runner guards against lookahead by entering from a candle and evaluating only later candles.
