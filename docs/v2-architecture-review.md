# V2 Architecture Review

Review date: 2026-07-14.

Scope: `server/v2/`, `server/routes.ts`, `server/telegram/`, `migrations/`, `docs/`, and the V2 test surface.

## Summary

Version 2 remains modular and demo-only. PostgreSQL operational persistence is module-owned, public API and Telegram compatibility are preserved, and live execution remains blocked.

One bounded architecture drift item was corrected:

- `operations/service.ts` depended on concrete peer PostgreSQL repository classes for orchestration and pilot projections. It now depends on local structural query contracts, preserving public behavior while removing concrete peer-repository coupling.

## Automated Checks

`server/v2.architecture-review.test.ts` verifies:

- no cross-module concrete repository imports;
- no direct V2 SQL outside repository implementations;
- no duplicate V2 event names;
- no broker or Telegram transport imports inside research modules;
- no direct V2 domain access to secret token environment variables;
- no circular imports in the supported V2 production graph.

## Findings

### Corrected

Severity: medium.

Evidence: operations projections imported concrete `PgOrchestrationRepository` and `PgDemoResearchPilotRepository` types. This made operations aware of peer implementation classes instead of public query shape.

Change: replaced concrete class imports with local structural projection interfaces for orchestration, pilot, and durable operations report repositories.

Compatibility: route contracts, Telegram summaries, daily reports, and PostgreSQL projection tests remain unchanged.

### Accepted Existing Boundaries

Severity: low.

Evidence: `server/routes.ts` is intentionally a Version 1/V2 HTTP composition layer and imports V1 execution services. V2 operations routes are registered through the V2 operations module and do not perform V2 domain decisions.

Decision: no rewrite in this milestone. Route size is technical debt, but splitting it would be broad V1 refactoring outside the operational-maturity goal.

### Deferred

- V2 barrel exports expose repository classes for test and integration convenience. Future public/implementation split is recommended, but changing exports now would be a compatibility migration.
- Several evidence modules still use in-memory repositories. Activity 2 addresses the operationally important subset.
- Some compact phase-era files combine multiple exports on one line. This is style debt, not demonstrated architectural risk.

## Safety Boundary Confirmation

- V2 does not place broker orders.
- V2 reliability explicitly rejects live OANDA endpoint markers.
- Telegram V2 commands remain read-only through the operations service.
- Demo-only and kill-switch tests remain part of the full test suite.
- ML support retains no decision authority.
- Persistence failures are typed and fail closed.

## Recommended Future Boundaries

- Keep repository implementations behind module-owned interfaces.
- Add durable evidence repositories only where evidence is costly, externally received, governance-critical, or needed after restart.
- Keep replay verification separate from replay domain logic.
- Keep telemetry as observation only; telemetry must not influence domain outcomes.
