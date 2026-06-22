BEGIN;

CREATE TABLE IF NOT EXISTS semi_autonomous_approvals (
  id text PRIMARY KEY,
  requested_by text NOT NULL,
  justification text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'expired')),
  scope jsonb NOT NULL,
  reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semi_autonomous_approvals_status_expiry
  ON semi_autonomous_approvals (status, expires_at);

CREATE TABLE IF NOT EXISTS execution_audit_exports (
  id text PRIMARY KEY,
  artifact_digest text NOT NULL,
  previous_artifact_digest text,
  signature text,
  signature_algorithm text NOT NULL,
  event_count integer NOT NULL,
  audit_entry_count integer NOT NULL,
  storage_location text,
  archive_location text,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_execution_audit_exports_generated_at
  ON execution_audit_exports (generated_at DESC);

CREATE TABLE IF NOT EXISTS marketpilot_events (
  id text PRIMARY KEY,
  version integer NOT NULL,
  type text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  user_id text NOT NULL,
  source_service text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketpilot_events_created_at
  ON marketpilot_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketpilot_events_correlation
  ON marketpilot_events (correlation_id);

CREATE TABLE IF NOT EXISTS execution_audit_entries (
  id text PRIMARY KEY,
  action text NOT NULL,
  outcome text NOT NULL,
  correlation_id text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_audit_entries_created_at
  ON execution_audit_entries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_audit_entries_correlation
  ON execution_audit_entries (correlation_id);

COMMIT;
