# V2 Demo Research Pilot

The demo research pilot starts Version 2 in controlled research/demo mode only. Startup gates require V2 and research enablement, live execution blocked, healthy kill switch, known PostgreSQL state, healthy repositories, healthy orchestration, no critical dead letters, safe broker mode, no seeded promoted strategies, compatible schemas, valid migrations, and safe provider state.

External practice trades default off and are not placed by ordinary verification.

## Durable Pilot State

Milestone B adds `PgDemoResearchPilotRepository` for restart-safe pilot state.

Durable pilot ownership:

- `v2_pilot_lifecycle` stores the current pilot state, config, current scorecard, lineage IDs, and version.
- `v2_pilot_lifecycle_transitions` stores immutable transition evidence with an idempotency key.
- `v2_pilot_scorecards` stores immutable scorecard snapshots keyed by pilot and scorecard version.
- `v2_pilot_reports` stores final report metadata and payloads.

Lifecycle transitions require the expected previous state and execute in a transaction. Concurrent conflicting transitions cannot both succeed. Safe stop updates the current lifecycle row and leaves all scorecard and transition evidence intact.

The repository does not start providers, place practice trades, send Telegram messages, or publish signals. It only persists pilot-owned operational state.
