# MarketPilot Strategy Machine Architecture

MarketPilot is a demo-only scientific strategy research machine. The strategy-machine code lives under `server/strategy-machine` and is organized by module boundary, not by database table.

## Module Boundaries

Each module owns its public contracts and emits immutable events. Modules may consume another module through typed contracts, event references, or immutable event envelopes. They must not read another module's repository tables directly and must not call another module's internal helpers.

Required module files:

- `contracts.ts`
- `events.ts`
- `service.ts`
- `repository.ts` where state is needed
- `index.ts`
- tests from the top-level `server/strategyMachine.test.ts` harness

## Event Lineage

Every event envelope includes:

- `correlationId` for a research workflow
- `causationId` for the direct parent action
- `sourceEventRefs` for immutable evidence
- `schemaVersion` and `contractVersion`

Source references point to previous immutable events. New rule or experiment versions must reference the older version instead of overwriting it.

## No Direct Table Access

Only the owning module can read or write its repository. Other modules receive typed inputs or event references. Cross-module repository or internal access is treated as an architecture violation.

## Safety

Execution modules must call the global `DemoOnlyPolicyService`. Live, real, production, unknown, or unverified account modes fail closed.
