BEGIN;

CREATE TABLE IF NOT EXISTS telegram_update_cursors (
  transport text PRIMARY KEY,
  last_update_id bigint NOT NULL,
  updated_at timestamp NOT NULL
);

COMMIT;
