# V2 Telegram Operations

Version 2 Telegram commands are read-only transport commands:

`/v2_status`, `/research_today`, `/observations`, `/hypotheses`, `/experiments`, `/backtests`, `/court_cases`, `/strategy_leaderboard`, `/forward_tests`, `/signals`, `/evaluator_results`, `/lessons`, `/strategy_health`, `/kill_status`.

Telegram handlers authenticate, normalize, call the public V2 operations service, and format responses. They cannot enable live trading.

## Projection Semantics

Telegram command responses use the same operations service as JSON routes. The transport layer does not query PostgreSQL or module-private tables.

When a collection has no durable projection, Telegram reports zero items with the service availability state. It must not fabricate observations, lessons, signals, or strategy health rows.

Delivery failures remain failures until a later explicit successful delivery attempt is recorded by the operations repository. Telegram cannot mark ambiguous delivery as delivered.
