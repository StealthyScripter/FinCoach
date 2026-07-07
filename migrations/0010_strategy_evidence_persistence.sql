BEGIN;

CREATE TABLE IF NOT EXISTS strategy_evidence_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id varchar NOT NULL,
  kind text NOT NULL,
  verdict text,
  symbol text,
  regime text,
  timeframe text,
  timestamp timestamp NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  outcome text,
  related_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_strategy_evidence_records_strategy_timestamp
  ON strategy_evidence_records (strategy_id, timestamp DESC);

COMMIT;
