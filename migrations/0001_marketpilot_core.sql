CREATE TABLE IF NOT EXISTS users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL
);

CREATE TABLE IF NOT EXISTS proficiency_scores (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  score integer NOT NULL,
  unlocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_modules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  title text NOT NULL,
  domain text NOT NULL,
  level text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  required_score integer NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'locked',
  lessons integer NOT NULL DEFAULT 1,
  gates jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  module_id varchar NOT NULL,
  category text NOT NULL,
  score integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  feedback jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_checks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  confidence integer NOT NULL,
  evidence_summary text NOT NULL,
  contradictory_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  what_would_disprove text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_reports (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_check_id varchar,
  agent text NOT NULL,
  title text NOT NULL,
  asset text,
  summary text NOT NULL,
  main_cause text NOT NULL,
  secondary_causes jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  classification text NOT NULL,
  confidence integer NOT NULL,
  generated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  title text NOT NULL,
  asset_focus text,
  status text NOT NULL,
  summary text NOT NULL,
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL,
  generated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_prices (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  name text NOT NULL,
  price real NOT NULL,
  change_pct real NOT NULL,
  volume_trend text NOT NULL,
  provider text NOT NULL,
  observed_at timestamp NOT NULL,
  ingested_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  impact text NOT NULL,
  starts_at timestamp NOT NULL,
  related_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  risk_note text NOT NULL,
  ingested_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_articles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  headline text NOT NULL,
  source text NOT NULL,
  reliability text NOT NULL,
  sentiment text NOT NULL,
  related_symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamp NOT NULL,
  ingested_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  "limit" text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS risk_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  max_risk_per_trade_pct real NOT NULL DEFAULT 1,
  reduce_size_above_pct real NOT NULL DEFAULT 0.5,
  max_daily_loss_pct real NOT NULL DEFAULT 2,
  max_weekly_loss_pct real NOT NULL DEFAULT 4,
  max_single_position_pct real NOT NULL DEFAULT 15,
  max_options_premium_pct real NOT NULL DEFAULT 1,
  no_trade_before_high_impact_event_hours integer NOT NULL DEFAULT 24,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_checks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_ticket_id varchar,
  decision text NOT NULL,
  score integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_portfolios (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  name text NOT NULL,
  total_value real NOT NULL,
  cash real NOT NULL,
  ytd_return_pct real NOT NULL DEFAULT 0,
  max_drawdown_pct real NOT NULL DEFAULT 0,
  risk_score integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id varchar NOT NULL,
  symbol text NOT NULL,
  name text NOT NULL,
  allocation real NOT NULL,
  value real NOT NULL,
  daily_change_pct real NOT NULL DEFAULT 0,
  risk_contribution real NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trade_tickets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  verification_check_id varchar,
  risk_check_id varchar,
  asset text NOT NULL,
  direction text NOT NULL,
  quantity real NOT NULL,
  entry_price real NOT NULL,
  stop_loss real,
  take_profit real,
  time_horizon text NOT NULL,
  rationale text NOT NULL,
  supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  portfolio_impact text NOT NULL DEFAULT '',
  alternative_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  exit_criteria text NOT NULL DEFAULT '',
  invalidation_condition text NOT NULL DEFAULT '',
  status text NOT NULL,
  risk_amount real NOT NULL,
  confidence integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  linked_ticket_id varchar,
  title text NOT NULL,
  quality_score integer NOT NULL DEFAULT 0,
  notes text NOT NULL,
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_reviews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  journal_entry_id varchar NOT NULL,
  quality_score integer NOT NULL,
  mistake_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  discipline_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback jsonb NOT NULL DEFAULT '[]'::jsonb,
  proficiency_category text NOT NULL,
  proficiency_delta integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  related_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_previews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_ticket_id varchar NOT NULL,
  user_id varchar NOT NULL,
  broker text NOT NULL,
  environment text NOT NULL,
  estimated_notional real NOT NULL,
  estimated_fees real NOT NULL,
  estimated_slippage real NOT NULL,
  estimated_total_cost real NOT NULL,
  buying_power_impact real NOT NULL,
  margin_requirement real NOT NULL,
  liquidity_check text NOT NULL,
  live_execution_blocked boolean NOT NULL DEFAULT true,
  compliance_acknowledgement_required boolean NOT NULL DEFAULT true,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  broker text NOT NULL,
  environment text NOT NULL,
  connection_status text NOT NULL,
  read_only boolean NOT NULL DEFAULT true,
  credentials_vaulted boolean NOT NULL DEFAULT false,
  mfa_verified boolean NOT NULL DEFAULT false,
  device_verified boolean NOT NULL DEFAULT false,
  session_fresh boolean NOT NULL DEFAULT false,
  admin_unlock boolean NOT NULL DEFAULT false,
  user_unlock boolean NOT NULL DEFAULT false,
  live_trading_enabled boolean NOT NULL DEFAULT false,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  disclosures_accepted boolean NOT NULL DEFAULT false,
  disclosure_version text NOT NULL DEFAULT 'marketpilot-risk-v1',
  accepted_at timestamp,
  user_confirmation text,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proficiency_scores_user_id ON proficiency_scores (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_user_id ON quiz_results (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_module_id ON quiz_results (module_id);
CREATE INDEX IF NOT EXISTS idx_research_reports_agent ON research_reports (agent);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_agent ON agent_outputs (agent);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_status ON agent_outputs (status);
CREATE INDEX IF NOT EXISTS idx_market_prices_symbol_observed_at ON market_prices (symbol, observed_at);
CREATE INDEX IF NOT EXISTS idx_economic_events_starts_at ON economic_events (starts_at);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles (published_at);
CREATE INDEX IF NOT EXISTS idx_risk_settings_user_id ON risk_settings (user_id);
CREATE INDEX IF NOT EXISTS idx_risk_checks_trade_ticket_id ON risk_checks (trade_ticket_id);
CREATE INDEX IF NOT EXISTS idx_paper_portfolios_user_id ON paper_portfolios (user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON holdings (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trade_tickets_user_id ON trade_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_trade_tickets_status ON trade_tickets (status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_journal_reviews_journal_entry_id ON journal_reviews (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_reviews_user_id ON journal_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_order_previews_trade_ticket_id ON order_previews (trade_ticket_id);
CREATE INDEX IF NOT EXISTS idx_order_previews_user_id ON order_previews (user_id);
CREATE INDEX IF NOT EXISTS idx_broker_connections_user_id ON broker_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_broker_connections_broker ON broker_connections (broker);
CREATE INDEX IF NOT EXISTS idx_compliance_profiles_user_id ON compliance_profiles (user_id);
