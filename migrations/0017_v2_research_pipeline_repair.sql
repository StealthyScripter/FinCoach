BEGIN;

ALTER TABLE v2_market_observations
  ADD COLUMN IF NOT EXISTS symbol text,
  ADD COLUMN IF NOT EXISTS timeframe text,
  ADD COLUMN IF NOT EXISTS observation_type text,
  ADD COLUMN IF NOT EXISTS detector_id text,
  ADD COLUMN IF NOT EXISTS detector_version text,
  ADD COLUMN IF NOT EXISTS strategy_family text,
  ADD COLUMN IF NOT EXISTS lifecycle text,
  ADD COLUMN IF NOT EXISTS observed_at timestamp,
  ADD COLUMN IF NOT EXISTS candle_start timestamp,
  ADD COLUMN IF NOT EXISTS candle_end timestamp,
  ADD COLUMN IF NOT EXISTS lookback_start timestamp,
  ADD COLUMN IF NOT EXISTS lookback_end timestamp,
  ADD COLUMN IF NOT EXISTS market_data_source text,
  ADD COLUMN IF NOT EXISTS source_data_hash text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS expires_at timestamp;

UPDATE v2_market_observations
SET
  symbol = COALESCE(symbol, payload->>'symbol'),
  timeframe = COALESCE(timeframe, payload->>'timeframe'),
  observation_type = COALESCE(observation_type, payload->>'observationType'),
  detector_id = COALESCE(detector_id, payload->>'detectorId'),
  detector_version = COALESCE(detector_version, payload->>'detectorVersion'),
  strategy_family = COALESCE(strategy_family, payload->>'strategyFamily'),
  lifecycle = COALESCE(lifecycle, payload->>'lifecycle'),
  observed_at = COALESCE(observed_at, NULLIF(payload->>'observedAt', '')::timestamp),
  candle_start = COALESCE(candle_start, NULLIF(payload->>'candleStart', '')::timestamp),
  candle_end = COALESCE(candle_end, NULLIF(payload->>'candleEnd', '')::timestamp),
  lookback_start = COALESCE(lookback_start, NULLIF(payload->>'lookbackStart', '')::timestamp),
  lookback_end = COALESCE(lookback_end, NULLIF(payload->>'lookbackEnd', '')::timestamp),
  market_data_source = COALESCE(market_data_source, payload->>'marketDataSource'),
  source_data_hash = COALESCE(source_data_hash, payload->>'sourceDataHash'),
  confidence = COALESCE(confidence, NULLIF(payload->>'confidence', '')::numeric),
  quality_score = COALESCE(quality_score, NULLIF(payload->>'qualityScore', '')::numeric),
  expires_at = COALESCE(expires_at, NULLIF(payload->>'expiresAt', '')::timestamp)
WHERE symbol IS NULL
   OR timeframe IS NULL
   OR observation_type IS NULL
   OR detector_id IS NULL
   OR detector_version IS NULL
   OR strategy_family IS NULL
   OR lifecycle IS NULL
   OR observed_at IS NULL
   OR candle_start IS NULL
   OR candle_end IS NULL
   OR lookback_start IS NULL
   OR lookback_end IS NULL
   OR market_data_source IS NULL
   OR source_data_hash IS NULL
   OR confidence IS NULL
   OR quality_score IS NULL
   OR expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_v2_market_observations_symbol_timeframe_type_created
  ON v2_market_observations (symbol, timeframe, observation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_detector_timeframe_created
  ON v2_market_observations (detector_id, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_lifecycle_expires
  ON v2_market_observations (lifecycle, expires_at);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_source_data_hash
  ON v2_market_observations (source_data_hash);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_strategy_family
  ON v2_market_observations (strategy_family);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_candle_end
  ON v2_market_observations (candle_end DESC);
CREATE INDEX IF NOT EXISTS idx_v2_market_observations_hypothesis_lookup
  ON v2_market_observations (symbol, timeframe, detector_id, observation_type, strategy_family, lifecycle, candle_end DESC)
  WHERE candle_end IS NOT NULL AND source_data_hash IS NOT NULL AND supersedes_id IS NULL;

CREATE TABLE IF NOT EXISTS v2_detector_evaluations (
  evaluation_id text PRIMARY KEY,
  schema_version text NOT NULL,
  cycle_id text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  detector_id text NOT NULL,
  detector_version text NOT NULL,
  strategy_family text,
  status text NOT NULL CHECK (status IN ('attempted', 'completed', 'skipped', 'failed', 'duplicate_suppressed')),
  reason text,
  candle_start timestamp,
  candle_end timestamp,
  source_data_hash text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_detector_evaluations_created_status
  ON v2_detector_evaluations (created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_v2_detector_evaluations_symbol_timeframe_detector
  ON v2_detector_evaluations (symbol, timeframe, detector_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_research_blocker_snapshots (
  blocker_id text PRIMARY KEY,
  schema_version text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  phase text NOT NULL,
  reason text NOT NULL,
  current_value text,
  required_value text,
  recommended_action text NOT NULL,
  first_observed_at timestamp NOT NULL,
  last_observed_at timestamp NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_research_blockers_code_phase
  ON v2_research_blocker_snapshots (code, phase);
CREATE INDEX IF NOT EXISTS idx_v2_research_blockers_severity_updated
  ON v2_research_blocker_snapshots (severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_orchestration_cycles_created_status
  ON v2_orchestration_cycles (created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_v2_orchestration_cycles_hour
  ON v2_orchestration_cycles (date_trunc('hour', created_at), requested_by);

COMMIT;
