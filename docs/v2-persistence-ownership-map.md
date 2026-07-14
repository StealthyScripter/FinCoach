# V2 Persistence Ownership Map

This map classifies V2 records before adding PostgreSQL tables. Module ownership remains strict: modules own their records and expose public contracts; no module may read another module's private tables.

Durable before an extended demo pilot:

- `orchestration_cycle`: owner `orchestration`; natural key `cycleId`; idempotency key `idempotencyKey`; mutable operational state; required for active-cycle restart.
- `orchestration_checkpoint`: owner `orchestration`; natural key `consumerId`; idempotency key `consumerId + sourceEventId`; mutable operational state; required for checkpoint resume.
- `consumer_acknowledgement`: owner `orchestration`; natural key `sourceEventId + consumerId`; idempotency key `idempotencyKey`; append-only; required for duplicate suppression.
- `retry_state`: owner `orchestration`; natural key `sourceEventId + consumerId`; idempotency key `sourceEventId + consumerId + attempt`; mutable operational state; required for retry budget recovery.
- `worker_lease`: owner `orchestration`; natural key `leaseName`; idempotency key `leaseName`; mutable by compare-and-set; required for multi-worker safety.
- `dead_letter`: owner `orchestration`; natural key `deadLetterId`; idempotency key `sourceEventId + reason`; append-only; required for poison/terminal event recovery.
- `pilot_lifecycle`: owner `pilot`; natural key `pilotId`; idempotency key `pilotId + transition`; mutable current state plus transition history; required for pilot restart.
- `pilot_scorecard`: owner `pilot`; natural key `pilotId`; idempotency key `pilotId + scorecardVersion`; mutable operational scorecard; required for safe-stop and reports.
- `daily_report`: owner `operations`; natural key `reportDate`; idempotency key `reportDate`; append-only; required for duplicate-report prevention.
- `daily_report_delivery`: owner `operations`; natural key `reportId + destination`; idempotency key `reportId + destination + deliveryAttempt`; explicit delivery status; required to avoid duplicate delivery and preserve failures.

Durable recommended after operational stores:

- forward tests, research signals, external evaluations, journal entries, lessons, lifecycle decisions, strategy revisions, court verdicts, ranking decisions, and reliability audit-chain records.

Safe to recompute or ephemeral:

- chart analysis, feature vectors, and replay cursors are deterministic or explicitly ephemeral.

The executable source of truth for this inventory is `server/v2/governance/persistenceInventory.ts`.

## V2.1 Evidence Persistence Decisions

Persist now:

- `forward-testing.forward_test`: table `v2_forward_tests`.
- `signals.research_signal`: table `v2_research_signals`.
- `external-evaluation.external_evaluation`: table `v2_external_evaluations`.
- `journal.research_journal_entry`: table `v2_research_journal_entries`.
- `learning.lesson`: table `v2_learning_lessons`.
- `learning.strategy_revision_proposal`: table `v2_learning_revision_proposals`.
- `strategy-evolution.strategy_revision`: table `v2_strategy_revision_proposals`.
- `strategy-lifecycle.lifecycle_decision`: table `v2_strategy_lifecycle_decisions`.
- `courtroom.court_verdict`: table `v2_court_verdicts`.
- `ranking.ranking_decision`: table `v2_ranking_decisions`.

Deferred with evidence:

- `hypothesis.research_hypothesis`, `experiments.research_experiment`, and `backtesting.backtest_result` remain important candidates for a later evidence migration, but the V2.1 operational priority is post-court, signal, external-evaluation, learning, and lifecycle evidence used by the extended pilot inspection loop.
- `ml-support.model_registry` and `ml-support.ml_evidence` remain durable recommended. ML has no decision authority, so this does not block the controlled demo pilot, but cloud replay should preserve ML evidence artifacts before long campaigns.

Safe to recompute or cache:

- Chart analysis and feature vectors remain recomputable from market data, registry versions, and replay clock.
- Replay cursors remain ephemeral except for orchestration checkpoints.

In-memory retained:

- In-memory repositories remain for deterministic unit tests and fixture-only runs.
- Durable pilot or extended replay modes must explicitly construct PostgreSQL repositories. They must not silently fall back to in-memory storage when durable evidence is required.
