# V2 Telegram Operations

Version 2 Telegram commands are read-only transport commands:

`/v2_status`, `/research_today`, `/observations`, `/hypotheses`, `/experiments`, `/backtests`, `/court_cases`, `/strategy_leaderboard`, `/forward_tests`, `/signals`, `/evaluator_results`, `/lessons`, `/strategy_health`, `/kill_status`.

Telegram handlers authenticate, normalize, call the public V2 operations service, and format responses. They cannot enable live trading.
