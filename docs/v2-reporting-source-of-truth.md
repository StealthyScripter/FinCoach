# FinCoach V2 Reporting Source Of Truth

Reporting surfaces must not infer durable research state from in-memory runtime counters.

## Durable Pipeline Counts

PostgreSQL is authoritative for persisted research artifacts. The canonical projection is `PgV2OperationsRepository.researchProgress()`.

| Reporting name | Relation |
| --- | --- |
| observations | `v2_market_observations` |
| detector evaluations | `v2_detector_evaluations` |
| hypotheses | `v2_research_hypotheses` |
| strategies | `v2_strategy_definitions` |
| experiments | `v2_research_experiments` |
| backtests | `v2_backtest_results` |
| verdicts | `v2_court_verdicts` |
| ranked candidates | `v2_ranking_decisions` |
| forward tests | `v2_forward_tests` |
| signals | `v2_research_signals` |
| external evaluations | `v2_external_evaluations` |
| journal entries | `v2_research_journal_entries` |
| lessons | `v2_learning_lessons` |
| lifecycle decisions | `v2_strategy_lifecycle_decisions` |
| pilot scorecards | `v2_pilot_scorecards` |

## Windows

All reporting windows are UTC:

| Window | Definition |
| --- | --- |
| `currentHour` | UTC hour containing `generatedAt` |
| `running24Hours` | rolling 24 hours ending at `generatedAt` |
| `running7Days` | rolling 7 days ending at `generatedAt` |
| `lifetime` | all durable rows in PostgreSQL |

## Runtime State

Runtime memory is authoritative only for ephemeral state: boot ID, active timers, scheduler state, next wake/cadence times, current in-flight cycle, and last in-memory error.

## Availability

`available_empty` means the repository/projection is configured and healthy with zero rows. Operator-facing Telegram output labels this as `configured_empty`.

`not_configured` is reserved for a repository/module that is not wired.

Projection failures must report degraded/unavailable states and sanitized `projectionError` values. They must not return zero counts.

## Data Freshness

Provider adapter health is separate from data freshness. Demo or synthetic feeds are not authoritative execution-grade data and must expose `sourceType`/`source` and `authoritative: false` where surfaced.
