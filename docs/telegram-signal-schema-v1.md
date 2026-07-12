# Telegram Signal Schema v1

Machine-readable Telegram signals use schema `fincoach.signal.v1`.

Signals are demo-research observations only. They are not live orders and must not be treated as guaranteed profitable.

## Human Message

Each signal starts with:

```text
📈 FINCOACH SIGNAL
Version: 1
Environment: DEMO_RESEARCH
```

The message includes signal ID, symbol, side, entry type, entry, stop loss, take profit, risk/reward, timeframe, strategy, confidence, evidence score, expiry, reason, invalidation, and generated timestamp.

## JSON Block

The compact JSON block contains:

```json
{
  "schema": "fincoach.signal.v1",
  "signalId": "uuid",
  "environment": "demo_research",
  "symbol": "EUR_USD",
  "displaySymbol": "EUR/USD",
  "side": "buy",
  "entryType": "market",
  "entryPrice": 1.0842,
  "stopLoss": 1.0818,
  "takeProfit": 1.0888,
  "riskReward": 1.92,
  "timeframe": "1h",
  "strategyId": "strategy-id",
  "strategyVersion": 3,
  "experimentId": "experiment-id",
  "confidence": 0.82,
  "evidenceScore": 0.79,
  "generatedAt": "ISO-8601",
  "validUntil": "ISO-8601",
  "demoOnly": true
}
```

Optional fields:

- `fingerprint`
- `idempotencyKey`
- `sequence`
- `signatureAlgorithm`
- `signature`

## Quality Gate

Signals publish only when all gates pass:

- demo run is running
- demo-only policy is healthy
- kill switch is inactive
- market data is fresh
- provider health is acceptable
- objective rule set exists
- experiment exists
- backtest evidence exists
- validation permits observation
- stability and sample-size thresholds pass
- minimum confidence and evidence score pass
- entry, stop loss, take profit, reward/risk, and invalidation are present
- event lineage is complete
- duplicate and cooldown checks pass
- market/session constraints pass
- news blackout is clear

Rejected signals are persisted and audited.

## Authenticity

If `TELEGRAM_SIGNAL_SIGNING_SECRET` is configured, signals include:

```json
{
  "signatureAlgorithm": "HMAC-SHA256",
  "signature": "<hex>"
}
```

The signature covers canonicalized signal fields. Never use the Telegram bot token as the signing secret.

## Versioning

Existing fields must not be changed in-place. Any incompatible change requires a new schema string, such as `fincoach.signal.v2`.
