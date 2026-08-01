BEGIN;

CREATE TABLE IF NOT EXISTS telegram_weekly_session_notifications (
  idempotency_key text PRIMARY KEY,
  transition_type text NOT NULL CHECK (transition_type IN ('open', 'close')),
  boundary_at timestamp NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'delivered', 'failed', 'skipped')),
  delivery_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_weekly_session_notifications_boundary
  ON telegram_weekly_session_notifications (transition_type, boundary_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_weekly_session_notifications_status
  ON telegram_weekly_session_notifications (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS telegram_market_snapshots (
  snapshot_id text PRIMARY KEY,
  period text NOT NULL CHECK (period IN ('morning', 'evening')),
  scheduled_local_date text NOT NULL,
  scheduled_local_time text NOT NULL,
  generated_at timestamp NOT NULL,
  timezone text NOT NULL,
  payload jsonb NOT NULL,
  message text NOT NULL,
  delivery_id text,
  delivery_status text NOT NULL CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  schema_version text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_market_snapshots_period_once
  ON telegram_market_snapshots (scheduled_local_date, period);

CREATE INDEX IF NOT EXISTS idx_telegram_market_snapshots_generated
  ON telegram_market_snapshots (generated_at DESC);

COMMIT;
