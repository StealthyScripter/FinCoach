BEGIN;

CREATE TABLE IF NOT EXISTS execution_submission_idempotency (
  idempotency_key text PRIMARY KEY,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_flight', 'in_doubt', 'completed')),
  reservation_id text NOT NULL,
  result jsonb,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_submission_status
  ON execution_submission_idempotency (status, updated_at);

CREATE TABLE IF NOT EXISTS execution_strategy_leases (
  strategy_id text PRIMARY KEY,
  lease_id text NOT NULL,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_strategy_leases_expires_at
  ON execution_strategy_leases (expires_at);

CREATE TABLE IF NOT EXISTS execution_reconciliation_reports (
  id text PRIMARY KEY,
  provider text NOT NULL,
  status text NOT NULL,
  report jsonb NOT NULL,
  reconciled_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_reconciliation_provider_time
  ON execution_reconciliation_reports (provider, reconciled_at DESC);

COMMIT;
