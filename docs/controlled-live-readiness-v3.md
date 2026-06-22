# MarketPilot Controlled Live Readiness v3

Broker practice/demo operation is documented in [broker-sandbox-v3.5.md](./broker-sandbox-v3.5.md). Production live order placement remains disabled.

## Scope and production boundary

Controlled Live Readiness v3 proves that the application can assemble a qualified, previewed, explicitly confirmed order workflow without enabling production real-money submission.

- Sandbox/demo submission is supported.
- Production submit is not implemented by the v3 adapter interface.
- Every adapter exposes `productionSubmitEnabled: false`.
- Permission never authorizes autonomous trading.
- Every proposed order requires a current, exact, single-use user confirmation.
- The global kill switch overrides permission, confirmation, and sandbox submission.
- Broker credentials remain external readiness facts; no plaintext credential field or storage path is provided.

## Permission gates

`LiveTradingPermissionService` defaults to blocked and evaluates:

- user proficiency threshold
- current compliance acknowledgement
- completed account risk profile
- verified broker connection
- correct sandbox/live account mode
- configured maximum daily loss
- configured maximum risk per trade
- armed, untriggered kill switch
- `supervised_live_candidate` strategy verdict
- passed, unexpired live safety quiz
- accepted emergency close policy
- encrypted external credential storage
- absence of emergency permission revocation

An allowed permission expires after 15 minutes. Production submission remains false even while permission is allowed.

## Live trading safety quiz

The quiz has one question for each required topic:

- leverage
- margin
- slippage
- spreads
- stop-loss failure
- news gaps
- commodity volatility
- forex rollover
- platform outages
- emotional trading
- irreversible order submission

The passing score is 90%. Results expire after 180 days and are audit logged. API responses do not expose correct choices.

## Order preview

`OrderPreviewService` calculates:

- instrument, side, order type, and quantity
- notional value
- estimated margin
- spread cost, commission, and slippage
- stop-loss and take-profit
- maximum loss estimate
- current and proposed portfolio exposure
- risk as a percentage of account equity
- strategy invalidation rule
- required confirmation phrase
- SHA-256 risk-summary hash

Previews expire after five minutes. Creation is audited, and `submissionAllowed` is always false because preview creation is not submission authorization.

## Final confirmation

The required phrase is:

> I understand this is a live trade and I accept the risk.

Confirmation requires:

- stored order preview ID
- user ID
- broker account ID
- client-supplied risk-summary hash matching the stored preview
- an ISO timestamp within 60 seconds of server time
- exact case-sensitive phrase match
- an unexpired preview

Accepted confirmations expire after 60 seconds and are single-use. The audit record stores identifiers and hashes, not broker credentials.

## Sandbox adapter pattern

The sandbox-only interface supports:

- account synchronization
- normalized instrument lookup
- controlled order preview
- sandbox submit
- order status
- position synchronization
- disconnect

Implementations:

- OANDA sandbox
- MetaTrader demo bridge
- generic REST broker sandbox

Sandbox submission requires a matching stored request, preview, permission, and confirmation. It rejects triggered kill switches, expired permission, expired or reused confirmation, provider mismatches, correlation mismatches, and unsupported instruments.

The adapter type does not contain a production submit method.

## Emergency controls

One atomic emergency activation:

- triggers the global kill switch
- closes all available paper and sandbox positions
- sets automation to Level 0
- revokes live permission
- freezes new signals
- requests broker disconnection
- emits an emergency audit report

Paper signal processing checks the shared emergency freeze before validation or placement.

## Readiness report

`LiveReadinessReportService` evaluates:

- user readiness
- strategy readiness
- broker readiness
- risk readiness
- security readiness
- compliance readiness
- system readiness

Verdicts:

- `blocked`: one or more required sections are incomplete
- `sandbox_only`: every readiness section passes while the production feature remains disabled
- `supervised_live_ready`: architecture gates pass and a separately controlled production feature is asserted

The application always passes `productionFeatureEnabled: false`, so its highest runtime verdict is `sandbox_only`. The service-level `supervised_live_ready` verdict exists for future independent release-control testing; it still reports production submission as disabled.

## Execution Center

The Live Readiness panel shows only:

- readiness verdict
- up to five missing requirements
- active daily-loss and per-trade risk limits
- kill-switch state
- next required action

Section-level readiness checks are inside a collapsed advanced-details control. The Circuit Breakers tab exposes the global kill switch and the atomic emergency action.
The Execution Center now also shows an autonomy roadmap card with the current automation level, next target, and current blockers to reduce ambiguity during operator review.
It also exposes a controlled-live workflow snapshot that shows quiz status, permission state, preview/confirmation counts, and the next missing gate before a live order can be confirmed.
The Execution Center now includes a guided workflow panel that can submit the live safety quiz, evaluate permission evidence, create a current preview, and issue the single-use final confirmation in sequence while preserving the production-disabled boundary.
The guided workflow also caches the latest preview and confirmation in the browser session so an operator can resume a partially completed controlled-live flow after a refresh, while stale previews are clearly marked as expired.
The backend now persists the controlled-live snapshot through the existing reliability-state store and exposes it at a dedicated controlled-live workflow endpoint, so the current quiz, permission, preview, and confirmation state survives process restarts when JSON-file durability is enabled.
The workflow also emits controlled-live event-log entries for quiz, permission, preview, confirmation, and sandbox submission transitions, and the Execution Center surfaces a compact replayable history panel for the latest events.
The history panel is run-scoped: it filters to the current user, preview ID, and preview correlation ID so operators can inspect one exact controlled-live flow without scanning unrelated events.
Each history row expands inline to show the recorded detail payload for that transition.
Each row also shows whether the entry came from the durable event store or from an ephemeral in-memory-only path.
Operators can jump the panel to the current run or pin a specific history row to inspect that exact controlled-live flow.
The replay panel also includes a compact four-step sequence rail for quiz, permission, preview, and confirmation so the current run state is visible at a glance.
The rail includes a legend for complete, current, and pending states so the color coding is self-explanatory.
The workflow history panel now also surfaces a compact run summary with the current step, pinned scope, history durability, and the latest transition timestamp so operators can triage the active flow without opening individual rows.

## Remaining steps before real live execution

- Independent legal, compliance, security, and model-risk approval.
- Production credential vault integration with rotation and access attestations.
- MFA/device/session binding for each final confirmation.
- Broker-specific production API clients implemented separately from sandbox adapters.
- Independent production retention, external archive replication, and auditor access policy. PostgreSQL append-only runtime audit persistence and signed external export artifacts are implemented for sandbox governance.
- Production-broker-specific ambiguous-submit lookup and recovery. Sandbox operation now has PostgreSQL transactional idempotency, distributed leases, durable reconciliation, read-only retry policy, and partial-fill normalization.
- Tested market-hours, holiday, rollover, financing, margin-call, and liquidation rules now feed the live-readiness report so session state and risk pressure are surfaced before the operator reaches order preview.
- Production observability, incident response, and disaster recovery. Live-readiness now carries a resilience gate that requires observability, incident-response drill evidence, disaster-recovery backup and restore proof, provider-recovery visibility, audit-export replication, and emergency controls before the operator can treat the environment as supervised-live ready. The Execution Center exposes the same resilience evidence through an operator tab and a dedicated resilience endpoint, and operators can record evidence entries for drills and recovery verification directly from the UI.
- Administrative production feature release remains separate. Level 6 sandbox eligibility now requires distinct Risk Officer and Compliance Officer approval.
- Restricted pilot with low notional limits and manual post-trade review.

Until those steps are complete, real production order placement must remain absent and disabled.
