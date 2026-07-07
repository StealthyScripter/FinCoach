BEGIN;

CREATE TABLE IF NOT EXISTS demo_run_records (
  run_id varchar PRIMARY KEY,
  mode text NOT NULL,
  state text NOT NULL,
  started_at timestamp NOT NULL,
  ended_at timestamp,
  payload jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_run_records_updated_at
  ON demo_run_records (updated_at DESC);

COMMIT;
