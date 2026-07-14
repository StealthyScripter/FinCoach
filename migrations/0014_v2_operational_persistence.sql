BEGIN;

CREATE TABLE IF NOT EXISTS v2_orchestration_cycles (
  cycle_id text PRIMARY KEY,
  schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'running', 'completed', 'failed', 'cancelled')),
  requested_by text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_cycles_status_updated ON v2_orchestration_cycles (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_cycles_correlation ON v2_orchestration_cycles (correlation_id);

CREATE TABLE IF NOT EXISTS v2_orchestration_checkpoints (
  consumer_id text PRIMARY KEY,
  schema_version text NOT NULL,
  source_event_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempt integer NOT NULL CHECK (attempt >= 0),
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  checkpointed_at timestamp NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_checkpoints_source_event ON v2_orchestration_checkpoints (source_event_id);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_checkpoints_updated ON v2_orchestration_checkpoints (updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_orchestration_consumer_acknowledgements (
  acknowledgement_id text PRIMARY KEY,
  schema_version text NOT NULL,
  source_event_id text NOT NULL,
  consumer_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  result_hash text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  created_at timestamp NOT NULL,
  UNIQUE (source_event_id, consumer_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_ack_event ON v2_orchestration_consumer_acknowledgements (source_event_id, consumer_id);

CREATE TABLE IF NOT EXISTS v2_orchestration_retries (
  retry_id text PRIMARY KEY,
  schema_version text NOT NULL,
  source_event_id text NOT NULL,
  consumer_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts >= 0),
  exhausted boolean NOT NULL DEFAULT false,
  next_retry_at timestamp,
  last_error_code text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (source_event_id, consumer_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_retries_pending ON v2_orchestration_retries (exhausted, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_retries_updated ON v2_orchestration_retries (updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_orchestration_worker_leases (
  lease_name text PRIMARY KEY,
  schema_version text NOT NULL,
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL,
  acquired_at timestamp NOT NULL,
  renewed_at timestamp NOT NULL,
  expires_at timestamp NOT NULL,
  released_at timestamp,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_worker_leases_expires ON v2_orchestration_worker_leases (expires_at);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_worker_leases_worker ON v2_orchestration_worker_leases (worker_id);

CREATE TABLE IF NOT EXISTS v2_orchestration_dead_letters (
  dead_letter_id text PRIMARY KEY,
  schema_version text NOT NULL,
  source_event_id text NOT NULL,
  reason text NOT NULL,
  retryable boolean NOT NULL,
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  last_replay_requested_at timestamp,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'orchestration',
  payload jsonb NOT NULL,
  created_at timestamp NOT NULL,
  UNIQUE (source_event_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_dead_letters_created ON v2_orchestration_dead_letters (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_dead_letters_replay ON v2_orchestration_dead_letters (retryable, replay_count, created_at);

CREATE TABLE IF NOT EXISTS v2_pilot_lifecycle (
  pilot_id text PRIMARY KEY,
  schema_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('not_started', 'starting', 'running', 'degraded', 'paused', 'stopping', 'stopped', 'failed', 'completed')),
  config jsonb NOT NULL,
  scorecard jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamp,
  stopped_at timestamp,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'pilot',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_pilot_lifecycle_state_updated ON v2_pilot_lifecycle (state, updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_pilot_lifecycle_transitions (
  transition_id text PRIMARY KEY,
  schema_version text NOT NULL,
  pilot_id text NOT NULL REFERENCES v2_pilot_lifecycle(pilot_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  from_state text,
  to_state text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  resulting_version integer NOT NULL CHECK (resulting_version >= 1),
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'pilot',
  created_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_pilot_lifecycle_transitions_pilot ON v2_pilot_lifecycle_transitions (pilot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_pilot_scorecards (
  scorecard_id text PRIMARY KEY,
  schema_version text NOT NULL,
  pilot_id text NOT NULL REFERENCES v2_pilot_lifecycle(pilot_id) ON DELETE CASCADE,
  scorecard_version integer NOT NULL CHECK (scorecard_version >= 1),
  idempotency_key text NOT NULL UNIQUE,
  scorecard jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'pilot',
  created_at timestamp NOT NULL,
  UNIQUE (pilot_id, scorecard_version)
);

CREATE INDEX IF NOT EXISTS idx_v2_pilot_scorecards_pilot_version ON v2_pilot_scorecards (pilot_id, scorecard_version DESC);

CREATE TABLE IF NOT EXISTS v2_pilot_reports (
  report_id text PRIMARY KEY,
  schema_version text NOT NULL,
  pilot_id text NOT NULL REFERENCES v2_pilot_lifecycle(pilot_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'pilot',
  created_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_pilot_reports_pilot_created ON v2_pilot_reports (pilot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_operations_daily_reports (
  report_id text PRIMARY KEY,
  schema_version text NOT NULL,
  report_date text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('created', 'degraded', 'failed')),
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'operations',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_operations_daily_reports_created ON v2_operations_daily_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_operations_daily_reports_status ON v2_operations_daily_reports (status);

CREATE TABLE IF NOT EXISTS v2_operations_daily_report_deliveries (
  delivery_id text PRIMARY KEY,
  schema_version text NOT NULL,
  report_id text NOT NULL REFERENCES v2_operations_daily_reports(report_id) ON DELETE CASCADE,
  destination text NOT NULL,
  delivery_attempt integer NOT NULL CHECK (delivery_attempt >= 1),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'ambiguous')),
  error_code text,
  error_message text,
  correlation_id text NOT NULL,
  causation_id text,
  source_module text NOT NULL DEFAULT 'operations',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (report_id, destination, delivery_attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_operations_daily_report_one_delivered ON v2_operations_daily_report_deliveries (report_id, destination) WHERE status = 'delivered';
CREATE INDEX IF NOT EXISTS idx_v2_operations_daily_report_delivery_status ON v2_operations_daily_report_deliveries (status, updated_at DESC);

COMMIT;
