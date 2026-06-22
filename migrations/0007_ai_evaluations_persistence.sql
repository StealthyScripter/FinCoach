BEGIN;

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  artifact_id varchar NOT NULL,
  artifact_type text NOT NULL,
  prompt_version text NOT NULL,
  output_summary text NOT NULL,
  overall_score integer NOT NULL,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_user_generated_at
  ON ai_evaluations (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_artifact_id
  ON ai_evaluations (artifact_id);

COMMIT;
