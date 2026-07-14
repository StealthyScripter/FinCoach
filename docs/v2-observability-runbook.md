# V2 Observability Runbook

## Metrics Snapshot

`GET /api/v2/metrics` returns the in-process V2 telemetry snapshot and always includes `liveExecutionBlocked: true`.

The endpoint exposes telemetry health, counters, gauges, histograms, and recent redacted operational events. It must not expose credentials, account identifiers, raw provider payloads, Telegram chat IDs, or unbounded metric labels.

## Local Checks

```bash
npx tsx server/v2.telemetry.test.ts
npx tsx server/v2.operational-maturity.test.ts
set -a; source .env; set +a; npx tsx server/v2.operational-maturity.pg.test.ts
```

## Replay With Telemetry

Short replay verification records source-event count, domain-event count, checkpoint count, and duration through the V2 telemetry contract. Generated metrics remain under ignored replay artifacts.

## Diagnosis

Use telemetry health first: `available` means the sink accepted recent samples, `degraded` means at least one metric or event was dropped, and `not_configured` means no sink is installed. Telemetry is not a replacement for durable repositories.
