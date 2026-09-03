BEGIN;

CREATE TABLE IF NOT EXISTS v2_execution_requests (
  record_id text PRIMARY KEY,
  schema_version text NOT NULL,
  natural_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source_module text NOT NULL,
  payload jsonb NOT NULL,
  lineage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_execution_requests_status_created
  ON v2_execution_requests ((payload->>'status'), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_execution_requests_signal
  ON v2_execution_requests ((payload->>'signalId'));
CREATE INDEX IF NOT EXISTS idx_v2_execution_requests_broker_trade
  ON v2_execution_requests ((payload->>'brokerTradeId'));

CREATE TABLE IF NOT EXISTS v2_demo_promotions (
  promotion_id text PRIMARY KEY,
  strategy_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_demo_promotions_strategy
  ON v2_demo_promotions (strategy_id);

COMMIT;
