BEGIN;

CREATE TABLE IF NOT EXISTS rag_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  query text NOT NULL,
  chunk_count integer NOT NULL,
  confidence integer NOT NULL,
  source_freshness text NOT NULL,
  citation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_runs_user_created_at
  ON rag_runs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_documents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  run_id varchar NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamp NOT NULL,
  chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_run_id
  ON rag_documents (run_id);

CREATE INDEX IF NOT EXISTS idx_rag_documents_user_created_at
  ON rag_documents (user_id, created_at DESC);

COMMIT;
