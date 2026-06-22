# MarketPilot Execution v2

## Safety boundary

Execution v2 supports offline/demo paper automation and supervised-live readiness assessment. It does not enable unrestricted autonomous live trading.

- Every provider order path runs risk precheck v2 and the existing circuit-breaker check.
- Every strategy definition requires stop logic.
- Every order, precheck, lifecycle transition, rejection, and simulated fill is audit logged with a correlation ID.
- Broker credentials are represented only as readiness booleans. No plaintext credential storage was added.
- A `supervised_live_candidate` verdict is research evidence, not execution authorization.
- Automation defaults to Level 0. Level 5 permits a supervised-live preview candidate, while Level 6 records bounded semi-autonomous eligibility requirements only. Production submission remains disabled and explicit user confirmation remains mandatory.

## Architecture

The execution domain remains under `server/execution/`.

| Component | Responsibility |
| --- | --- |
| `strategyValidation.ts` | Produces backtest, walk-forward, Monte Carlo, drawdown, ruin, sample-size, overfitting, regime, and symbol scores with a final verdict. |
| `automationLevels.ts` | Defines Levels 0–6: disabled, signals, paper tracking, paper execution, sandbox execution, supervised-live candidate, and bounded semi-autonomous candidate. Default is Level 0. Level 6 cannot submit production orders. |
| `tradeLifecycle.ts` | Enforces typed trade-state transitions, emits audit events, generates journal timelines, and flags prediction review. |
| `riskPrecheck.ts` | Evaluates market, account, exposure, news, strategy, loss, and kill-switch conditions before provider placement. |
| `positionSizing.ts` | Calculates risk-constrained forex and commodity sizes, leverage limits, and margin estimates. |
| `signalQuality.ts` | Scores signal reliability and returns accept, reject, paper-only, or watch-only. |
| `brokerConnectionReadiness.ts` | Checks broker configuration and operational readiness without placing an order. |
| `executionCenter.ts` | Selects the limited primary dashboard data and advanced operator data. |

## Strategy validation

`StrategyValidationService` returns:

- backtest score
- walk-forward score
- Monte Carlo robustness score
- drawdown score
- risk-of-ruin score
- trade-count sufficiency
- overfitting warning
- regime sensitivity
- symbol suitability
- overall score and verdict

Verdicts are `reject`, `paper_only`, `watchlist`, and `supervised_live_candidate`. A newly registered strategy starts with a conservative rejected/unvalidated scorecard until evidence is submitted.

## Automation levels

| Level | Capability |
| --- | --- |
| 0 | Disabled |
| 1 | Signal collection and scoring only |
| 2 | Paper tracking without order placement |
| 3 | Paper execution with constrained entry and exit automation |
| 4 | Practice/demo sandbox execution with confirmation |
| 5 | Supervised-live preview candidacy; explicit user confirmation required |
| 6 | Bounded semi-autonomous candidate; production submission remains disabled |

Background signal processing must use the level-gated autonomous method. The existing paper signal endpoint is an explicit user/API invocation and remains paper-only.

Upward transitions require a named actor, the exact acknowledgement, and one-level-at-a-time progression. Higher levels additionally require registered and validated strategies, configured constraints, continuous monitoring, kill-switch availability, sandbox readiness, and unexpired supervised permission. Level 6 remains blocked until independent semi-autonomous approval exists. Downgrades remain immediately available and emergency controls force Level 0.

## Trade lifecycle

The lifecycle begins at `signal_received` and permits only declared transitions through validation, rejection, paper order creation, simulated fill, active monitoring, stop/target/manual/expiry closure, and review.

Invalid transitions throw and do not mutate state. Rejection or closure triggers prediction review. A generated journal contains the complete event timeline.

## Risk precheck v2

The precheck evaluates stale data, spread, volatility, daily loss, open positions, symbol exposure, correlated exposure, news blackout, repeated losses, strategy status, kill switch, account connection, account synchronization, and live confirmation.

Possible actions:

- `approve`
- `reject`
- `reduce_size`
- `wait`
- `manual_review`

Only `approve` and `reduce_size` may continue to provider placement. The provider applies the reduction before simulated fill and records the decision.

## Position sizing

Forex sizing supports EUR/USD, GBP/USD, USD/JPY, XAU/USD, and XAG/USD. It reports pip value, standard lot size, risk budget, stop distance, conversion placeholder status, leverage constraint, margin estimate, suggested size, maximum safe size, and final constrained size.

Commodity sizing supports XAU/USD, XAG/USD, WTI, and Brent. It reports tick value, contract multiplier, stop distance, margin estimate, volatility adjustment, risk cap, suggested contracts, maximum safe contracts, and final constrained contracts.

Instrument metadata is a configurable approximation for paper/demo calculations. Broker-specific contract specifications and account-currency conversion quotes must replace these assumptions before controlled live use.

## Signal quality

Signals are scored using source reliability, strategy validation, timeframe, trend alignment, volatility regime, spread/liquidity, recent false signals, news risk, and risk/reward. Hard safety failures force rejection even if the weighted score is otherwise high.

## Broker readiness

Readiness checks credentials configured, encrypted storage, reachability, paper/live mode, margin, permissions, supported instruments, rate-limit headroom, sync freshness, environment match, and emergency disconnect.

The result may permit paper readiness or supervised-live preview readiness, but `liveOrderSubmissionAllowed` is always false.

## Execution Center

The primary screen is limited to:

- automation level
- kill-switch state
- open paper-position count
- current risk-precheck action
- latest signals
- strategy validation verdicts
- open paper-position details

Advanced tabs are Backtests, Strategy validation, Broker readiness, Audit log, and Circuit breakers.

## Remaining gaps toward controlled live execution

- Real encrypted credential-vault integration and rotation.
- Provider-specific instrument metadata, conversion rates, margin rules, and market calendars.
- Market-session rules now evaluate open/closed hours, holidays, rollover windows, financing acknowledgements, margin-call pressure, and liquidation thresholds before live-readiness can advance.
- Production resilience now requires observability, incident-response drill evidence, disaster-recovery backup and restore proof, provider-recovery visibility, audit-export replication, and emergency controls before supervised-live readiness can advance.
- The Execution Center exposes a production resilience tab and `/api/marketpilot/execution/resilience` endpoint so operators can inspect those requirements directly, plus `/api/marketpilot/execution/resilience/evidence` for recorded drill and recovery evidence.
- Read-only broker synchronization with retry, reconciliation, and rate-limit telemetry.
- Persistent lifecycle, validation, and audit storage with immutable retention.
- Structured event-log export is available through the operator API for external log shipping and replay tooling.
- A trace explorer endpoint combines event-log and execution-audit records by correlation ID for operator investigation.
- A companion OTel-shaped trace export endpoint maps the same correlation timeline into span-like records for downstream observability tooling.
- Knowledge-graph snapshots now emit append-only archive events so knowledge evidence can be replayed from the event log.
- Institutional analytics snapshots now emit append-only archive events so regime, consensus, behavior, factor, stress, and Greeks evidence can be replayed from the event log.
- Historical model-validation benchmarks now compare canonical allocations against deterministic crisis/recovery fixtures and archive the result for replay.
- Semantic vector retrieval now persists to PostgreSQL when configured, while keeping the same similarity contract as the in-memory store.
- The Intelligence Desk now charts Monte Carlo bands, stress scenarios, factor exposure, and Greeks payoff curves.
- News-calendar provider integration and tested blackout policies.
- Correlation models based on maintained historical datasets.
- Administrative approval, device/MFA gates, final order preview, and per-order user confirmation.
- Independent security, compliance, model-risk, and failure-recovery review.

Until those gaps are closed, MarketPilot remains paper-first and live-order placement remains disabled.

The next controlled-readiness layer is described in [controlled-live-readiness-v3.md](./controlled-live-readiness-v3.md).
