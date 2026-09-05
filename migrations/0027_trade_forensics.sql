BEGIN;

CREATE TABLE IF NOT EXISTS trade_forensics (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id varchar NOT NULL UNIQUE,
  broker_trade_id varchar,
  symbol text NOT NULL,
  entered_at timestamp NOT NULL,
  closed_at timestamp NOT NULL,
  generated_at timestamp NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_forensics_symbol_closed_at
  ON trade_forensics (symbol, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_forensics_broker_trade_id
  ON trade_forensics (broker_trade_id)
  WHERE broker_trade_id IS NOT NULL;

COMMIT;
