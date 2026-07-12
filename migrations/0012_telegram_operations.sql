BEGIN;

CREATE TABLE IF NOT EXISTS telegram_deliveries (
  id varchar PRIMARY KEY,
  kind text NOT NULL,
  destination text NOT NULL,
  chat_id_redacted text,
  status text NOT NULL,
  text_hash text NOT NULL,
  message_id text,
  error_code text,
  error_message text,
  retry_after_seconds integer,
  attempt_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_created_at ON telegram_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_status ON telegram_deliveries (status);

CREATE TABLE IF NOT EXISTS telegram_signals (
  signal_id varchar PRIMARY KEY,
  schema text NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  symbol text NOT NULL,
  payload jsonb NOT NULL,
  human_message text NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamp,
  expires_at timestamp NOT NULL,
  last_update_at timestamp NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_telegram_signals_status ON telegram_signals (status);
CREATE INDEX IF NOT EXISTS idx_telegram_signals_expires_at ON telegram_signals (expires_at);

CREATE TABLE IF NOT EXISTS telegram_signal_updates (
  id varchar PRIMARY KEY,
  signal_id varchar NOT NULL REFERENCES telegram_signals(signal_id) ON DELETE CASCADE,
  outcome text NOT NULL,
  message text NOT NULL,
  result_r real,
  demo_pnl real,
  lesson text,
  created_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_signal_updates_signal_id ON telegram_signal_updates (signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_summaries (
  id varchar PRIMARY KEY,
  period text NOT NULL,
  summary_date text NOT NULL,
  concise_message text NOT NULL,
  report jsonb NOT NULL,
  delivery_id varchar,
  created_at timestamp NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_summaries_once ON telegram_summaries (period, summary_date);

CREATE TABLE IF NOT EXISTS telegram_scheduler_runs (
  id varchar PRIMARY KEY,
  job_name text NOT NULL,
  status text NOT NULL,
  lease_key text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp NOT NULL,
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_telegram_scheduler_runs_job ON telegram_scheduler_runs (job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS telegram_command_audit (
  id varchar PRIMARY KEY,
  command text NOT NULL,
  actor_id_redacted text NOT NULL,
  chat_id_redacted text NOT NULL,
  authorized boolean NOT NULL,
  outcome text NOT NULL,
  reason text,
  created_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_command_audit_created_at ON telegram_command_audit (created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_lifecycle_state (
  id varchar PRIMARY KEY,
  process_id text NOT NULL UNIQUE,
  heartbeat_at timestamp NOT NULL,
  clean_shutdown boolean NOT NULL DEFAULT false,
  started_at timestamp NOT NULL,
  stopped_at timestamp
);

COMMIT;
