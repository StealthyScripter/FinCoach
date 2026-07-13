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
