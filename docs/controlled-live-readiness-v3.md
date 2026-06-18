# MarketPilot Controlled Live Readiness v3

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

## Remaining steps before real live execution

- Independent legal, compliance, security, and model-risk approval.
- Production credential vault integration with rotation and access attestations.
- MFA/device/session binding for each final confirmation.
- Broker-specific production API clients implemented separately from sandbox adapters.
- Immutable persistent audit storage and external audit export.
- Broker reconciliation, idempotency keys, duplicate-submit protection, retry policy, and partial-fill handling.
- Tested market-hours, holiday, rollover, financing, margin-call, and liquidation rules.
- Production observability, incident response, and disaster recovery.
- Administrative feature release with two-person approval.
- Restricted pilot with low notional limits and manual post-trade review.

Until those steps are complete, real production order placement must remain absent and disabled.
