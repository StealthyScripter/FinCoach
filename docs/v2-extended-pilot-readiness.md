# V2 Extended Demo Pilot Readiness

Deterministic readiness verdict: `ready_with_documented_degradations`.

The audit was local only. It did not start live trading, enable OANDA live execution, place OANDA practice orders, call external providers, or send Telegram messages.

## Gate Results

- Required migrations applied: pass.
- PostgreSQL available and healthy: pass.
- Durable orchestration state: pass.
- Durable idempotency: pass.
- Durable pilot state: pass.
- Durable dead-letter handling: pass.
- Real operations projections: pass for durable orchestration, pilot, and daily-report state; degraded by documented `not_configured` evidence-module projections.
- No unresolved critical dead letters: pass.
- No unknown broker mode: pass; readiness audit uses explicit practice/demo boundary only and no broker call.
- Live execution blocked: pass.
- Kill switch healthy: pass.
- No seeded promoted strategies: pass.
- No unsafe feature flag enabled: pass.
- No stale critical data: pass.
- Daily report delivery state durable: pass.
- Restart simulation passed: pass.
- Signal compatibility passed: pass.
- External evaluator ingestion contract passed: pass with local fixture contract only.
- Backups and restoration documented: pass through `docs/v2-migration-recovery.md` and `docs/v2-disaster-recovery.md`.

## Documented Degradations

- Evidence-module read projections for observations, hypotheses, experiments, backtests, court cases, strategies, forward tests, signals, evaluations, journal, lessons, models, and lifecycle are explicit `not_configured` states unless their upstream module exposes durable projection data.
- Durable operational repositories are complete for the extended pilot core; durable recommended evidence repositories remain deferred by the persistence ownership map.

## Pilot Simulation

The deterministic local fixture covers:

`market data -> context -> chart analysis -> features -> fundamentals -> observations -> trader analysis -> hypotheses -> rules -> experiments -> backtests -> courtroom -> market memory -> ranking -> lifecycle -> forward-test simulation -> signal -> external evaluation -> journal -> learning -> ML evidence -> strategy evolution -> lifecycle decision -> orchestration -> operations projection -> pilot scorecard`.

No external providers, Telegram delivery, broker calls, live endpoints, or OANDA practice orders are used.

## Operational Prerequisites

- Apply migration `0014_v2_operational_persistence.sql`.
- Configure PostgreSQL and verify `npm run test:pgstorage`.
- Run `server/v2.durable-repositories.pg.test.ts`, `server/v2.operations-projections.pg.test.ts`, `server/v2.restart-recovery.pg.test.ts`, and `server/v2.extended-pilot-readiness.test.ts` with `.env` sourced.
- Keep signal publication and forward testing feature flags disabled unless a later controlled demo policy explicitly enables them.

## Monitoring Requirements

- PostgreSQL health and migration compatibility.
- Orchestration cycle status, retry counts, stale leases, and dead-letter counts.
- Pilot lifecycle state and scorecard updates.
- Daily report creation and delivery states.
- Projection availability states, especially `temporarily_unavailable`, `schema_incompatible`, `degraded`, and `stale`.
- Live execution blocker and kill-switch health.

## Pause Or Stop Conditions

- Any unknown broker mode.
- Any live execution path becoming selectable.
- Any unresolved critical dead letter.
- Any schema-incompatible persisted row.
- PostgreSQL outage affecting checkpoint, idempotency, lease, pilot, or daily-report state.
- Stale critical data before forward-test or signal creation.
- Missing lineage, stop loss, or take profit for a forward-test or signal candidate.
- Any Telegram delivery ambiguity for the daily report.

## Rollback Procedures

- Stop V2 operations intake.
- Preserve V2 operational tables; do not delete evidence rows.
- Disable pilot startup flags and keep live execution blocked.
- Restore PostgreSQL from the latest verified backup if corruption is confirmed.
- Re-run migration and restart recovery validation before resuming the controlled demo pilot.

## Recommended Pilot Duration And Resources

- Start with 5 trading days of controlled demo research.
- Extend to 10 trading days only if dead letters remain zero, projections remain healthy or explicitly degraded, and no restart recovery issue appears.
- Expected resources are one PostgreSQL database, one V2 operations process, local deterministic fixture providers, and no broker or Telegram delivery dependency.
