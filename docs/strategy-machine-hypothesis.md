# Strategy Machine Hypotheses

The hypothesis module converts detected pattern events into testable statements. Hypotheses include supported markets, timeframes, regime tags, score, required sample size, and source pattern references.

The module can emit:

- `HypothesisCreated`
- `HypothesisRejected`
- `HypothesisNeedsMoreData`

Hypotheses remain research artifacts. They do not trigger execution.
