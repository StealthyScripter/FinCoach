# V2 Research Pipeline Operations

## Root Cause

`runResearchPath` created each hypothesis from one just-created observation while the hypothesis policy required at least two independent observations and evidence IDs. Observation persistence also used random UUIDs as natural and idempotency keys, so replayed detector output was not semantically deduplicated. Evidence fingerprints omitted symbol, timeframe, detector, candle window, and source data hash, which allowed evidence IDs to be reused across symbols.

## Current Control Flow

The repaired research cycle is:

1. Build a bounded detector-symbol-timeframe plan from detector capability metadata.
2. Generate or fetch complete candle snapshots.
3. Evaluate due detectors and persist detector evaluation metrics.
4. Persist positive observations with semantic natural keys and source lineage.
5. Query persisted historical observations over a bounded lookback.
6. Require distinct observation IDs and distinct candle windows before creating hypotheses.
7. Compile rules, queue experiments, run bounded backtests, create courtroom verdicts, and rank candidates.
8. Return `completed_with_blockers` when any phase is blocked.

Live trading remains blocked. The code never changes `FINCOACH_LIVE_EXECUTION_ENABLED`.

## Orchestration Safety Status

`/api/v2/runtime/status` exposes a sanitized `orchestrationSafety` block with:

- `maxCyclesPerUtcDay`
- `cycleTimeoutMs`
- `leaseTtlMs`
- `leaseRenewIntervalMs`
- `liveExecutionBlocked`
- safe blocker codes such as `daily_limit_reached`, `lease_held`, `lease_lost`, `cycle_timed_out`, `stale_cycle_recovered`, and `invalid_orchestration_configuration`

The status response must not expose `DATABASE_URL`, raw worker IDs, SQL errors, or stack traces. Lease owner IDs in logs are hashed/truncated.

## Verification Commands

Use the scripts actually present in `package.json`:

```bash
npm test
npm run check
npm run build
```

There is no `lint` script in the current `package.json`. Run lint only after adding a script.

Migration and dry-run:

```bash
npm run db:migrate
tsx scripts/v2-runtime.ts pilot:run-once
```

## Verification SQL

```sql
SELECT timeframe, count(*) FROM v2_market_observations GROUP BY timeframe ORDER BY timeframe;
SELECT count(*) FROM v2_market_observations WHERE created_at >= date_trunc('hour', now() AT TIME ZONE 'UTC');
SELECT count(*) FROM v2_market_observations WHERE created_at >= now() - INTERVAL '24 hours';
SELECT count(*) FROM v2_market_observations WHERE created_at >= now() - INTERVAL '7 days';
SELECT natural_key, count(*) FROM v2_market_observations GROUP BY natural_key HAVING count(*) > 1;
SELECT ev->>'evidenceId' AS evidence_id, count(DISTINCT symbol) AS symbols FROM v2_market_observations CROSS JOIN LATERAL jsonb_array_elements(payload->'evidence') ev GROUP BY ev->>'evidenceId' HAVING count(DISTINCT symbol) > 1;
SELECT count(*) FROM v2_research_hypotheses;
SELECT count(*) FROM v2_research_experiments;
SELECT count(*) FROM v2_backtest_results;
SELECT count(*) FROM v2_court_verdicts;
SELECT count(*) FROM v2_ranking_decisions;
SELECT code, severity, phase, last_observed_at FROM v2_research_blocker_snapshots ORDER BY severity, last_observed_at DESC;
SELECT date_trunc('hour', created_at) AS hour, count(*) FROM v2_orchestration_cycles GROUP BY hour ORDER BY hour DESC LIMIT 24;
```

## API Verification

```bash
curl -s http://127.0.0.1:${PORT:-5000}/api/v2/status
curl -s http://127.0.0.1:${PORT:-5000}/api/v2/runtime/status
curl -s http://127.0.0.1:${PORT:-5000}/api/v2/research/progress
curl -s http://127.0.0.1:${PORT:-5000}/api/v2/research/blockers
```

## Weekly Research Schedule

The V2 research scheduler remains inside the application process. It does not stop PM2, Express, PostgreSQL, Telegram long polling, health reporting, daily summaries, weekly summaries, or read-only Telegram commands.

Research cycle admission is gated by the aggregate configured tradable window. FinCoach derives whether any configured instrument remains tradable from, in order, existing calendar/session services, configured instrument metadata, and labeled conservative fallback rules. Unknown configured symbols fail closed and are reported as unavailable calendar metadata.

The default operator opening window is Sunday 5:00 PM `America/New_York` with a five-minute lead. The closing boundary is dynamic: research stops only after the final configured tradable instrument is no longer tradable. A single exchange close does not suspend research while another configured instrument remains tradable.

Continuously traded symbols such as crypto use an operator-defined weekly maintenance window so they do not prevent maintenance forever:

```env
FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_ENABLED=true
FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_DAY=5
FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_TIME=18:00
FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_DAY=0
FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_TIME=17:00
```

All weekly and snapshot schedule calculations use IANA timezones such as `America/New_York`; fixed EST offsets are not used.

Read-only verification:

```bash
curl -fsS http://127.0.0.1:5000/api/v2/runtime/status |
jq '{
  state,
  weeklyResearchSchedule: .weeklyResearchSchedule,
  aggregateTradableWindow: .aggregateTradableWindow,
  marketSnapshotScheduler: .marketSnapshotScheduler,
  researchSchedulerActive: .researchSchedulerActive,
  liveExecutionBlocked
}'
```

```bash
curl -fsS http://127.0.0.1:5000/api/v2/market-sessions | jq
curl -fsS 'http://127.0.0.1:5000/api/v2/market-snapshot/events?lookaheadHours=24&minimumImpact=5&limit=20' | jq
curl -fsS http://127.0.0.1:5000/api/v2/market-snapshot | jq
```

PostgreSQL read-only checks:

```sql
SELECT idempotency_key, transition_type, boundary_at, status, delivery_id, updated_at
FROM telegram_weekly_session_notifications
ORDER BY updated_at DESC
LIMIT 5;

SELECT snapshot_id, period, scheduled_local_date, generated_at, delivery_status, delivery_id
FROM telegram_market_snapshots
ORDER BY generated_at DESC
LIMIT 5;

SELECT id, kind, status, metadata, created_at
FROM telegram_deliveries
WHERE kind IN ('market_session', 'report')
ORDER BY created_at DESC
LIMIT 10;
```

Rollback: deploy the prior application build and leave migration `0018` in place. It is additive and backward compatible. Keep `FINCOACH_LIVE_EXECUTION_ENABLED=false`; do not enable paper, demo broker, or live execution as part of rollback.

## Telegram Verification

From an authorized Telegram user:

```text
/research_progress
/research_blockers
```

Aliases: `/progress`, `/pipeline`, `/blockers`, `/readiness`.

## Deployment

1. Confirm `FINCOACH_LIVE_EXECUTION_ENABLED=false`.
2. Run `npm run check`.
3. Run focused tests: `tsx server/v2.research-pipeline-repair.test.ts`.
4. Run `npm test`.
5. Apply migrations with `npm run db:migrate`.
6. Run `tsx scripts/v2-runtime.ts pilot:run-once`.
7. Check `/api/v2/research/progress` and `/api/v2/research/blockers`.
8. Send `/research_progress` and `/research_blockers` from the authorized Telegram account.
9. Verify cycle counts remain bounded with the scheduler SQL above.

## Rollback

1. Stop V2 runtime autostart.
2. Restore the prior application build or commit.
3. Leave migration `0017` in place; it is additive and compatible with older payloads.
4. Keep `FINCOACH_LIVE_EXECUTION_ENABLED=false`.
5. Confirm no broker order endpoints were invoked.
