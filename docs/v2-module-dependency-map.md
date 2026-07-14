# V2 Module Dependency Map

This map summarizes the reviewed V2 architecture. The executable guard is `server/v2.architecture-review.test.ts`.

## Core Spine

- `contracts`: domain event envelope, module names, feature flags.
- `lineage`: event lineage validation over public domain events.
- `governance`: dependency rules, safety boundary, persistence inventory.
- `persistence`: typed PostgreSQL error taxonomy.

Core modules are shared dependencies. They must not depend on downstream research modules.

## Research Flow

`market-data -> market-context -> chart-analysis -> feature-engineering -> fundamentals -> observations -> trader-emulators -> hypothesis -> rules -> experiments -> backtesting -> courtroom -> market-memory -> ranking -> forward-testing -> signals -> external-evaluation -> journal -> learning -> ml-support -> strategy-evolution -> strategy-lifecycle`

Modules may import public contracts from upstream modules where necessary. They must not import peer concrete repository implementations.

## Operational Flow

- `orchestration`: routes public events to consumers and owns checkpoints, acknowledgements, retries, leases, and dead letters.
- `operations`: exposes transport-safe read projections and daily reports from public repository/query contracts.
- `pilot`: owns demo pilot lifecycle and scorecard state.
- `reliability`: owns operational safety checks, circuit-breakers, leases, audit-chain style health, and live endpoint rejection.

## Routes And Telegram

- `server/routes.ts` composes HTTP routes and preserves V1 behavior.
- `server/telegram/` owns Telegram transport, scheduler, formatting, command authorization, and delivery persistence.
- V2 Telegram commands call the V2 operations service only and cannot enable live trading.

## Repository Rules

- SQL is allowed in module-owned PostgreSQL repositories and tests.
- SQL is not allowed in V2 services, routes, Telegram handlers, or peer modules.
- Cross-module concrete repository imports are forbidden.
- Operations projections use structural public query contracts rather than peer implementation types.

## Event Rules

- V2 event names must be unique.
- Every event uses the shared V2 domain event envelope.
- Correlation IDs are required.
- Causation IDs are required for non-root events where applicable.

## Current Deferred Dependencies

- `operations` can project only repositories explicitly provided to it.
- Evidence modules that are still in-memory remain `not_configured` in operations projections until Activity 2 persistence is introduced.
- Barrel exports remain broad for compatibility; future hardening can split public contracts from implementation exports.
