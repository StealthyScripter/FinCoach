BEGIN;

CREATE TABLE IF NOT EXISTS v2_forward_tests (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'forward-testing',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_forward_tests_strategy_created ON v2_forward_tests ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_forward_tests_status_created ON v2_forward_tests ((payload->>'status'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_forward_tests_lineage ON v2_forward_tests USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_research_signals (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'signals',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_research_signals_symbol_created ON v2_research_signals ((payload->>'symbol'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_signals_strategy_created ON v2_research_signals ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_signals_lineage ON v2_research_signals USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_external_evaluations (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'external-evaluation',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_external_evaluations_signal_created ON v2_external_evaluations ((payload->>'signalId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_external_evaluations_outcome_created ON v2_external_evaluations ((payload->>'outcome'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_external_evaluations_lineage ON v2_external_evaluations USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_research_journal_entries (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'journal',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_research_journal_subject_created ON v2_research_journal_entries ((payload->>'subjectId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_journal_supersedes ON v2_research_journal_entries (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_research_journal_lineage ON v2_research_journal_entries USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_learning_lessons (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'learning',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_learning_lessons_topic_created ON v2_learning_lessons ((payload->>'topic'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_learning_lessons_supersedes ON v2_learning_lessons (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_learning_lessons_lineage ON v2_learning_lessons USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_learning_revision_proposals (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'learning',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_learning_revision_proposals_strategy_created ON v2_learning_revision_proposals ((payload->>'strategyId'), created_at DESC);

CREATE TABLE IF NOT EXISTS v2_strategy_revision_proposals (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'strategy-evolution',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_revision_parent_created ON v2_strategy_revision_proposals ((payload->>'parentStrategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_revision_lineage ON v2_strategy_revision_proposals USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_strategy_lifecycle_decisions (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'strategy-lifecycle',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_lifecycle_strategy_created ON v2_strategy_lifecycle_decisions ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_lifecycle_state_created ON v2_strategy_lifecycle_decisions ((payload->>'toState'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_lifecycle_lineage ON v2_strategy_lifecycle_decisions USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_court_verdicts (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'courtroom',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_court_verdicts_strategy_created ON v2_court_verdicts ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_court_verdicts_verdict_created ON v2_court_verdicts ((payload->>'verdict'), created_at DESC);

CREATE TABLE IF NOT EXISTS v2_ranking_decisions (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'ranking',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ranking_decisions_created ON v2_ranking_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_ranking_decisions_lineage ON v2_ranking_decisions USING gin (lineage_event_ids);

COMMIT;
