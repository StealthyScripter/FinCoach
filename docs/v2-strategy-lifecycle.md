# V2 Strategy Lifecycle and Decay

The lifecycle module governs strategy state transitions and decay decisions. It records immutable lifecycle decisions and evaluates expectancy drift, drawdown, calibration, evidence freshness, regime mismatch, external disagreement, and edge decay.

Lifecycle governance does not generate hypotheses, publish signals, call brokers, or execute trades.

## States

`draft`, `hypothesis`, `experiment`, `validated`, `court-approved`, `forward-test`, `candidate`, `focused`, `paused`, `degraded`, `retired`, `archived`

## Events

- `StrategyPromoted`
- `StrategyPaused`
- `StrategyDegraded`
- `StrategyRetired`
- `StrategyRecovered`
- `StrategyLifecycleRejected`
- `StrategyLifecycleDuplicateSuppressed`
