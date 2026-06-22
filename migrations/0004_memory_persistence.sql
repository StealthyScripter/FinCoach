BEGIN;

CREATE TABLE IF NOT EXISTS memory_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  scope text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_records_user_scope_created_at
  ON memory_records (user_id, scope, created_at DESC);

COMMIT;
