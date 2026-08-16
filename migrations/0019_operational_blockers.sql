CREATE TABLE IF NOT EXISTS operational_blockers (
  id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  kind text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  what_blocked text NOT NULL,
  reason text NOT NULL,
  current_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  limit_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  config_key text,
  config_value_state text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected boolean NOT NULL DEFAULT true,
  action text NOT NULL,
  effect text,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'active',
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  occurrence_count integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_blockers_status_last_seen
  ON operational_blockers (status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_blockers_code_scope
  ON operational_blockers (code, fingerprint);
