BEGIN;

CREATE TABLE IF NOT EXISTS time_series_price_bars (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timestamp timestamp NOT NULL,
  open real NOT NULL,
  high real NOT NULL,
  low real NOT NULL,
  close real NOT NULL,
  volume bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_series_price_bars_symbol_timestamp
  ON time_series_price_bars (symbol, timestamp DESC);

CREATE TABLE IF NOT EXISTS time_series_economic_observations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id text NOT NULL,
  timestamp timestamp NOT NULL,
  value real NOT NULL,
  source text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_series_economic_observations_series_timestamp
  ON time_series_economic_observations (series_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS time_series_options_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying text NOT NULL,
  timestamp timestamp NOT NULL,
  implied_volatility_pct real NOT NULL,
  open_interest bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_series_options_snapshots_underlying_timestamp
  ON time_series_options_snapshots (underlying, timestamp DESC);

CREATE TABLE IF NOT EXISTS time_series_ingestion_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  status text NOT NULL,
  started_at timestamp NOT NULL,
  completed_at timestamp NOT NULL,
  records integer NOT NULL,
  freshness_newest_timestamp timestamp,
  freshness_oldest_timestamp timestamp,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_time_series_ingestion_runs_completed_at
  ON time_series_ingestion_runs (completed_at DESC);

COMMIT;
