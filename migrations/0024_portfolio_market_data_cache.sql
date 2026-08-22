CREATE TABLE IF NOT EXISTS portfolio_market_data_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL,
  endpoint text NOT NULL,
  symbol text,
  interval text,
  provider_timestamp timestamptz,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  stale_until timestamptz NOT NULL,
  payload jsonb NOT NULL,
  payload_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_market_data_cache_freshness
  ON portfolio_market_data_cache (endpoint, symbol, interval, expires_at, stale_until);
