# V2 Strategy Evolution

Strategy evolution creates bounded child strategy revision proposals from validated parents and upstream evidence. It preserves parent-child lineage and records proposed mutations only.

The module does not overwrite parents, run experiments, bypass courtroom review, approve strategies, promote strategies, or execute trades.

## Events

- `StrategyRevisionProposed`
- `StrategyRevisionRejected`
- `StrategyRevisionDuplicateSuppressed`

## Bounds

Numeric parameter changes must stay within parent-declared bounds. Rule changes must appear in the parent's approved rule-change allowlist.
