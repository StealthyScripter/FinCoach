# V2 Feature Engineering

The feature-engineering module derives normalized quantitative features from public chart-analysis and market-context contracts. It does not recompute indicators, produce strategies, emit signals, or call broker execution.

Each feature is registered in a versioned registry with deterministic compute policy and `futureDataAllowed: false`. Computation rejects future-dated inputs relative to the vector effective timestamp.

Computed feature vectors include input event IDs, input time range, definition versions, quality scores, missing-data state, correlation ID, and causation ID. The in-memory repository is idempotent by vector ID; later PostgreSQL persistence must preserve immutable history.
