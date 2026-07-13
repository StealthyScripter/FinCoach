# FinCoach Version 2 Architecture Baseline

FinCoach Version 2 is introduced behind feature flags and a separate `server/v2` boundary. Phase 0 does not activate research, forward testing, signal publishing, broker execution, schedulers, routes, or Telegram commands.

## Module Boundary

Each Version 2 module communicates through public contracts and immutable events. Modules may depend on `contracts`, `lineage`, `telemetry`, and `governance` by default. Cross-module repository access and private implementation imports are architecture violations. The orchestration module may coordinate public contracts, but it must not perform analysis or own module business logic.

## Event Envelope

All significant Version 2 actions use `DomainEvent<T>`:

```ts
type DomainEvent<T> = {
  eventId: string;
  eventType: string;
  schemaVersion: string;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  sourceModule: string;
  payload: T;
  metadata: Record<string, unknown>;
};
```

The initial schema version is `fincoach.v2.event.1`. Unsupported schema versions fail validation. Derived events must carry causation and lineage references before they can be promoted into execution or publishing paths.

## Contracts

Phase 0 defines:

- event envelope contract;
- lineage reference contract;
- module health contract;
- error classification contract;
- feature flag contract;
- dependency rule contract;
- V1/V2 compatibility boundary.

Unknown errors fail closed as terminal until a module classifies them more specifically.

## Feature Flags

The default state is off:

- `FINCOACH_V2_ENABLED=false`
- `FINCOACH_V2_RESEARCH_ENABLED=false`
- `FINCOACH_V2_FORWARD_TESTING_ENABLED=false`
- `FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED=false`

Forward testing also requires the existing demo-only safety policy to be safe.

## Safety

Live execution remains blocked. Version 2 does not change existing OANDA, Telegram, demo-run, risk-control, or execution behavior in Phase 0. The compatibility boundary explicitly reports `liveExecutionBlocked: true` and checks the existing demo-only policy.

## Phase 0 Limitations

This phase establishes architecture and contracts only. Business modules, persistence migrations, APIs, Telegram operations, and autonomous orchestration are intentionally deferred to later phases.

## Phase 1 Market Data Foundation

The initial Version 2 market-data module lives in `server/v2/market-data`. It owns symbol normalization, quote and candle normalization, provider adapter contracts, quality scoring, duplicate detection, gap detection, freshness checks, import idempotency, and checkpoint cursors.

Provider adapters return data only. They do not expose broker order methods, and the market-data service has no execution dependency. OANDA practice history and stock data are represented through adapter contracts so provider-specific implementations can be added without changing downstream module contracts.

The Phase 1 repository is contract-driven and currently includes an in-memory implementation for deterministic tests. PostgreSQL-backed persistence will use the same `MarketDataRepositoryContract` when the database is available for migrations and integration verification.
