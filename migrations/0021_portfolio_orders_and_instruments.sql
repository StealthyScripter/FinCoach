BEGIN;

CREATE TABLE IF NOT EXISTS portfolio_instruments (
  instrument_id text PRIMARY KEY,
  symbol text NOT NULL,
  display_name text NOT NULL,
  asset_class text NOT NULL,
  subtype text,
  exchange text,
  currency text NOT NULL DEFAULT 'USD',
  country text,
  sector text,
  industry text,
  market_calendar text NOT NULL,
  tick_size numeric(18, 8),
  lot_size numeric(24, 8),
  contract_multiplier numeric(18, 6),
  underlying text,
  option_strike numeric(18, 6),
  option_expiration date,
  option_type text,
  bond_maturity date,
  coupon numeric(18, 8),
  provider_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  benchmark_eligible boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_instruments_symbol_asset
  ON portfolio_instruments (symbol, asset_class);

CREATE TABLE IF NOT EXISTS portfolio_orders (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  side text NOT NULL,
  symbol text,
  asset_class text,
  quantity numeric(24, 8),
  status text NOT NULL,
  reason text NOT NULL,
  submitted_at timestamptz NOT NULL,
  filled_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_portfolio_orders_portfolio_time
  ON portfolio_orders (portfolio_id, submitted_at DESC);

COMMIT;
