# MarketPilot Limited Autonomy Governance v5

MarketPilot remains production-order-disabled. This governance layer controls eligibility for Level 6 bounded semi-autonomous operation in paper and sandbox environments only.

## Independent approval

A Level 6 approval request defines:

- Explicit strategy IDs and instruments
- Maximum risk per trade
- Maximum daily loss
- Maximum open positions and notional
- Reference equity used to enforce maximum risk per trade
- Monitoring interval
- Fixed expiry of 15 minutes to 24 hours
- Mandatory `sandboxOnly: true`

The requester cannot review the request. Approval requires two distinct reviewers with separate roles:

- Risk Officer
- Compliance Officer

One rejection rejects the request. Duplicate reviewers and duplicate roles are rejected. PostgreSQL uses row-locked mutations so concurrent reviews cannot overwrite one another.

Approvals expire automatically and can be revoked immediately by a named actor with a reason. Revocation while Level 6 is active forces Level 0 and stops automated strategy evaluation. Candle processing also rechecks approval validity and strategy scope.

Approval never enables production order placement.

## Level 6 transition

The standard one-level-at-a-time automation transition gate still applies. Level 6 additionally requires:

- Active independently approved scope
- Every active strategy included in that scope
- Approved daily loss no greater than the configured circuit breaker
- Signed audit export configuration
- Durable governance repository

`MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY` and `MARKETPILOT_AUDIT_EXPORT_DIR` must be configured. With `DATABASE_URL`, governance records persist in PostgreSQL using migration `0003_execution_governance.sql`.

## Audit exports

Audit exports contain:

- Versioned artifact metadata
- Hash-chained MarketPilot events
- Hash-chained execution audit entries
- Digest link to the previous export
- Artifact SHA-256 digest
- Optional HMAC-SHA256 signature
- Production-disabled marker

Configured exports are written atomically with owner-only file permissions. Export metadata is append-only in PostgreSQL. Verification recomputes the artifact digest, HMAC signature, event chain, and execution audit chain.
If `MARKETPILOT_AUDIT_ARCHIVE_DIR` is configured, each export is also mirrored to a separate archive location so the stored artifact can still be retrieved if the primary export directory is unavailable. The Execution Center can retrieve a stored export by ID and surface the verification result for operator review.

Unsigned exports remain useful for development but do not satisfy Level 6 readiness.

## Remaining production boundary

Production execution still requires independently reviewed broker clients, session-bound MFA, secure credential rotation, production incident response, disaster recovery exercises, legal approval, and a separately released production feature boundary.
