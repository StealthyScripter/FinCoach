BEGIN;

CREATE TABLE IF NOT EXISTS vector_records (
  id varchar PRIMARY KEY,
  vector jsonb NOT NULL,
  text text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_vector_records_text
  ON vector_records (text);

COMMIT;
