BEGIN;

ALTER TABLE v2_demo_promotions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DROP INDEX IF EXISTS idx_v2_demo_promotions_strategy;
CREATE INDEX IF NOT EXISTS idx_v2_demo_promotions_strategy_created
  ON v2_demo_promotions (strategy_id, created_at DESC, promotion_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_demo_promotions_idempotency
  ON v2_demo_promotions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
