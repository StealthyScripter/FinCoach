BEGIN;

CREATE TABLE IF NOT EXISTS v2_market_observations (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'observations',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_symbol_created ON v2_market_observations ((payload->>'symbol'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_lifecycle_created ON v2_market_observations ((payload->>'lifecycle'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_lineage ON v2_market_observations USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_research_hypotheses (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'hypothesis',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_research_hypotheses_status_created ON v2_research_hypotheses ((payload->>'status'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_hypotheses_lineage ON v2_research_hypotheses USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_strategy_definitions (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'rules',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_definitions_hypothesis_created ON v2_strategy_definitions ((payload->>'hypothesisId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_strategy_definitions_lineage ON v2_strategy_definitions USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_research_experiments (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'experiments',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_research_experiments_status_created ON v2_research_experiments ((payload->>'status'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_experiments_strategy_created ON v2_research_experiments ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_research_experiments_lineage ON v2_research_experiments USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_backtest_results (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL DEFAULT 'backtesting',
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_backtest_results_status_created ON v2_backtest_results ((payload->>'status'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_backtest_results_strategy_created ON v2_backtest_results ((payload->>'strategyId'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_backtest_results_lineage ON v2_backtest_results USING gin (lineage_event_ids);

CREATE TABLE IF NOT EXISTS v2_runtime_boot_records (
  boot_id text PRIMARY KEY,
  schema_version text NOT NULL,
  previous_boot_id text,
  inferred_previous_exit text NOT NULL,
  runtime_enabled boolean NOT NULL,
  research_enabled boolean NOT NULL,
  live_execution_enabled boolean NOT NULL,
  heap_limit_bytes bigint,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_runtime_boot_records_created ON v2_runtime_boot_records (created_at DESC);

COMMIT;
