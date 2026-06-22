# MarketPilot Live Data and Paper Strategy Ops v4

This release adds practice/demo market data, candle-driven paper strategy operations, event risk gates, and post-trade learning. Production live order placement remains impossible.

## Price feed architecture

`PriceFeedService` normalizes polling and streaming providers into:

- Symbol
- Bid, ask, mid, and spread
- Provider timestamp
- Provider
- Freshness (`fresh`, `aging`, or `stale`)
- Confidence

Polling adapters support the deterministic demo feed and any `DemoBrokerAdapter`, including OANDA practice and the MetaTrader demo bridge. Streaming providers implement a subscription interface and return an unsubscribe callback. The service rejects malformed bid/ask data, records every tick in the event/audit logs, and recalculates freshness when data is read.

Stale prices are not suitable for strategy submission. Default thresholds are 15 seconds for aging and 30 seconds for stale.

## Candle builder

`CandleBuilderService` builds in-memory OHLCV candles for `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`. Prices are bucketed on UTC boundaries. A bucket transition closes the previous candle, stores it, emits `market.candle_closed`, updates metrics, and notifies candle subscribers.

The in-memory store retains the latest 1,000 closed candles per symbol/timeframe.

## Strategy operations

`StrategyOpsService` subscribes strategies to symbols and timeframes. On each closed candle it executes:

```text
kill switch → event blackout → strategy rule → signal quality
→ risk precheck → paper runtime or sandbox confirmation queue
```

Operational strategies can route only to local paper automation or a sandbox-confirmation-required result. There is no production route.

Every evaluation rechecks the global automation level. Level 0 rejects signals, Level 1 records qualified signals only, Level 2 tracks them without orders, Level 3 permits paper execution, and Level 4 permits sandbox-confirmation routing. Levels 5–6 do not bypass confirmation or enable production submission.

The HTTP runtime accepts three deterministic rule templates initially:

- Bullish candle
- Bearish candle
- Range breakout

Custom application code can subscribe richer rule callbacks through the service interface.

## Paper runtime

`PaperStrategyRuntime` supports:

- Start and stop
- Allowed symbols
- Maximum trades per day
- Maximum open positions
- UTC session filter
- Stop-loss
- Take-profit
- Trailing stop
- Journal entries
- Audited lifecycle transitions

Ticks mark positions to market and close them when an exit condition is reached. The global kill switch prevents strategy starts and new positions. All positions are local paper positions.

Strategy start acquires an expiring ownership lease before evaluation is enabled. A second runtime cannot acquire the same active strategy lease, and stop disables candle evaluation before releasing ownership. The current lease store is process-local with explicit acquire, renew, release, expiry, event, and audit contracts so a distributed Redis/PostgreSQL lease implementation can replace it without changing strategy operations.

## Post-trade learning

`PostTradeReviewService` records the thesis, entry and exit reasons, expected and actual moves, risk, result, strengths, failures, missing evidence, lesson, and strategy improvement note.

Each review feeds:

- Review journal
- Prediction review service
- Proficiency graph update queue
- Strategy validation score adjustment ledger
- Strategy adaptation suggestions

The live-data runtime automatically reviews paper trades closed by incoming ticks. Sandbox close workflows can pass their normalized closed-trade record to the same review service.

## Strategy adaptation

Suggestions include tighter/wider stops, smaller size, session/symbol avoidance, confirmation requirements, downgrade/pause recommendations, and entry-rule improvements. Suggestions always start as `pending_human_approval`, expose `automaticallyApplied: false`, and require an explicit named reviewer to approve or reject them.

No suggestion mutates a strategy.

## Strategy lifecycle monitoring

Closed paper trades now feed a deterministic lifecycle monitor. It calculates win rate, expectancy, profit factor, maximum drawdown, recent-vs-baseline deterioration, and consecutive-loss evidence. Reports classify strategies as `maintain`, `watch`, `pause`, or `retire`.

Pause and retirement recommendations remain `pending_human_review`. A named reviewer may approve or reject the report, but the monitor never stops, retires, or changes a strategy automatically. Every evaluation and review is audit logged, and insufficient samples are explicitly identified instead of being treated as evidence.

## Event blackout windows

`EconomicEventRiskService` starts with manually configured:

- CPI
- NFP
- FOMC
- Central-bank rate decisions
- Crude-oil inventories
- Major geopolitical risk

Events match explicit symbols or asset classes. User settings define block/warn severities and minutes before/after the event. Each evaluation is emitted to both event and audit logs.

## Execution Center

The default strategy performance panel shows only:

- Active paper strategies
- Today's signals
- Open positions
- Unrealized P/L
- Realized P/L and risk status

Price feeds, strategy operations, paper runtime, reviews, adaptation suggestions, and blackouts are available in focused tabs with advanced information collapsed.

## Remaining production-grade supervised execution work

Production execution would require a separate reviewed implementation: durable market-data replay, production-broker ambiguous-submit lookup, independent risk authorization, durable external audit export, user/MFA binding, supervised limits, compliance approval, and incident response. Sandbox operations now include PostgreSQL-coordinated leases and idempotency, reconciliation, partial-fill handling, and provider recovery telemetry.

No production broker environment, provider enum, or live-order endpoint is introduced by v4.
