BEGIN;

CREATE TABLE IF NOT EXISTS auth_sessions (
  sid varchar NOT NULL,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expire
  ON auth_sessions (expire);

COMMIT;
