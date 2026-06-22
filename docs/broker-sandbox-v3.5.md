# MarketPilot Broker Sandbox v3.5

Live data and candle-driven paper operations are documented in [live-data-paper-strategy-ops-v4.md](./live-data-paper-strategy-ops-v4.md).

MarketPilot supports real broker practice/demo environments for forex and commodities. Production live order submission remains hard-disabled in every adapter, API response, workflow, metric, and UI projection.

## OANDA practice setup

Set `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, and `OANDA_ENV=practice`. The adapter uses `https://api-fxpractice.oanda.com/v3`. Any environment other than `practice` is rejected. Tokens are used only in authorization headers and must never enter logs or audit details.

Supported operations are account summary, instruments, pricing, risk-hashed preview, confirmed practice submission, order status, pending orders, positions, trades, health, and disconnect. Tests inject mocked HTTP and require no paid API.

## MetaTrader demo bridge contract

Set `METATRADER_DEMO_BRIDGE_URL` to an operator-controlled HTTP bridge. Every response must identify `environment: "demo"`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Bridge health |
| GET | `/account` | Balance, equity, and margin |
| GET | `/symbols` | Supported symbols |
| GET | `/pricing/:symbol` | Pricing snapshot |
| POST | `/orders/preview` | Demo order preview |
| POST | `/orders` | Demo order submit |
| GET | `/orders/:id` | Order status |
| GET | `/orders?status=pending` | Pending orders |
| GET | `/positions` | Open positions |
| POST | `/positions/:id/close` | Close demo position |
| POST | `/disconnect` | Disconnect bridge |

The transport is an interface; tests use a fake bridge and never require a local MetaTrader terminal.

## Credential vault

`CredentialVault` stores provider, account ID, token reference, environment, created time, last-used time, and status. `InMemoryCredentialVault` supports tests and ephemeral use. `EnvironmentCredentialVault` is read-only and exposes only `env:OANDA_API_TOKEN`, never the token. `redactSensitive` recursively redacts tokens, authorization headers, API keys, secrets, and passwords.

## Account sync

`AccountSyncService` synchronizes balance, equity, margin, positions, pending orders, trades, account mode, and provider health. Each sync emits a `sandbox.account_synced` event, an execution audit entry, and a metrics update.

## Sandbox order flow

```text
signal → validation → risk precheck → risk-hashed preview → exact confirmation
→ sandbox submit → order status → position monitor → journal entry
```

Every stage is audited. The submit API requires the exact confirmation phrase and preview SHA-256 hash. Previews expire and are single-use. The global kill switch is checked before preview, in the risk precheck, and immediately before submission.

Confirmed submissions also require an idempotency key. Concurrent or retried requests with the same key and identical preview fingerprint share one broker operation and return the recorded result with `replayed: true`. Reusing a key for different submission data is rejected. The current registry is process-local and intentionally isolated behind a service boundary for later durable Redis/PostgreSQL replacement.

Set `MARKETPILOT_RELIABILITY_STATE_FILE` to persist idempotency records, strategy leases, and reconciliation reports in an atomic, permission-restricted JSON state file. Without it, the same interface uses ephemeral memory. The file adapter provides restart durability for a single process; multi-instance deployment still requires a transactional PostgreSQL or Redis implementation.

When `DATABASE_URL` is configured and migration `0002_execution_reliability.sql` is applied, PostgreSQL becomes the cross-process transaction coordinator. Submission reservations use row locks and owner tokens; strategy leases use row locks, owner checks, and expirations; reconciliation reports are durably appended. Local/file state remains an operator cache and restart fallback.

Order submission is never automatically retried because a transport failure may occur after the broker accepted the order. Read-only account, position, trade, pending-order, health, and order-status requests use bounded exponential retry only for rate limiting and temporary disconnection. Kill-switch checks remain authoritative.

If submission loses connectivity or receives a rate-limit failure at an ambiguous point, its idempotency record becomes `in_doubt`. Restart recovery also converts orphaned `in_flight` records to `in_doubt`. The key remains blocked until a named operator records the observed broker result or explicitly confirms that the broker did not submit the order and authorizes a retry.

Order results normalize `partially_filled` with requested, filled, remaining units, and average fill price when providers expose them. Reconciliation permits normal pending-to-partial-to-filled progression while reporting quantity mismatches.

Read-only retry recovery emits provider- and operation-labelled telemetry for each attempt, successful recovery, and terminal failure. Automatic order resubmission remains disabled.

## Broker reconciliation

MarketPilot keeps a submitted sandbox-order ledger and can reconcile it against provider order status, pending orders, positions, and trades. Reports identify missing orders and status mismatches, emit `sandbox.reconciliation_completed`, update metrics, and preserve the production-disabled marker. Reconciliation is read-only and never repairs broker state automatically.

## Symbol mapping

| Internal | OANDA | MetaTrader |
| --- | --- | --- |
| EUR/USD | EUR_USD | EURUSD |
| GBP/USD | GBP_USD | GBPUSD |
| USD/JPY | USD_JPY | USDJPY |
| XAU/USD | XAU_USD | XAUUSD |
| XAG/USD | XAG_USD | XAGUSD |
| WTI | WTICO_USD | XTIUSD |
| Brent | BCO_USD | XBRUSD |

Mappings include pip/tick size, trade units, minimum/maximum size, margin estimate, and market hours.

## Failure handling

Stable user-facing failures cover stale prices, rejected orders, insufficient margin, disconnected providers, invalid instruments, rate limits, missing tokens, expired confirmation, active kill switch, and non-demo environments.

## Execution Center

The primary panel exposes only connection status, account mode, equity, margin available, open sandbox positions, latest order status, and emergency controls. Provider diagnostics remain collapsed.

## Production-live disabled policy

No adapter implements a production endpoint or environment. OANDA accepts practice only; MetaTrader accepts demo only. Every contract exposes `productionOrderSubmissionEnabled: false`, and production submission metrics remain zero.

## Remaining supervised-live work

A future production implementation requires a separate security-reviewed path with isolated credentials, deployment controls, legal/compliance approval, MFA/session binding, durable cross-process replay protection, independent risk authorization, supervised rollout limits, incident-response exercises, and external audit evidence. None is enabled here.
