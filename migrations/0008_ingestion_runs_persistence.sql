BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  provider_id text NOT NULL,
  status text NOT NULL,
  started_at timestamp NOT NULL,
  completed_at timestamp NOT NULL,
  records integer NOT NULL,
  freshness_newest_timestamp timestamp,
  freshness_oldest_timestamp timestamp,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_completed_at
  ON ingestion_runs (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_user_completed_at
  ON ingestion_runs (user_id, completed_at DESC);

COMMIT;
