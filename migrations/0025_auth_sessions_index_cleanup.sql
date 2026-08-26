BEGIN;

DO $$
BEGIN
  IF to_regclass('"IDX_session_expire"') IS NOT NULL THEN
    DROP INDEX "IDX_session_expire";
  END IF;

  IF to_regclass('auth_sessions_expire_idx') IS NOT NULL THEN
    DROP INDEX auth_sessions_expire_idx;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expire
  ON auth_sessions (expire);

COMMIT;
