BEGIN;

CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_iterations integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);
CREATE INDEX IF NOT EXISTS idx_auth_users_status ON auth_users (status);

CREATE TABLE IF NOT EXISTS portfolio_strategies (
  id text PRIMARY KEY,
  short_name text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  mandate text NOT NULL,
  risk_level integer NOT NULL CHECK (risk_level BETWEEN 1 AND 10),
  risk_label text NOT NULL,
  lifecycle_state text NOT NULL,
  strategy_version integer NOT NULL DEFAULT 1,
  parent_strategy_id text REFERENCES portfolio_strategies(id),
  research_hypothesis text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  benchmark_symbol text NOT NULL,
  starting_capital numeric(18, 4) NOT NULL CHECK (starting_capital > 0),
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_strategies_lifecycle ON portfolio_strategies (lifecycle_state, risk_level);

CREATE TABLE IF NOT EXISTS portfolios (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id),
  starting_capital numeric(18, 4) NOT NULL CHECK (starting_capital > 0),
  cash numeric(18, 4) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(strategy_id)
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  asset_class text NOT NULL,
  quantity numeric(24, 8) NOT NULL,
  average_cost numeric(18, 6) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, symbol)
);

CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  side text NOT NULL,
  symbol text NOT NULL,
  asset_class text NOT NULL,
  quantity numeric(24, 8) NOT NULL,
  price numeric(18, 6) NOT NULL,
  fee numeric(18, 6) NOT NULL DEFAULT 0,
  realized_pnl numeric(18, 6) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_portfolio_time
  ON portfolio_transactions (portfolio_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_nav_history (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  nav numeric(18, 4) NOT NULL,
  cash numeric(18, 4) NOT NULL,
  market_value numeric(18, 4) NOT NULL,
  realized_pnl numeric(18, 4) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(18, 4) NOT NULL DEFAULT 0,
  daily_pnl numeric(18, 4) NOT NULL DEFAULT 0,
  weekly_pnl numeric(18, 4) NOT NULL DEFAULT 0,
  source text NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_nav_history_portfolio_time
  ON portfolio_nav_history (portfolio_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_decision_journal (
  id text PRIMARY KEY,
  portfolio_id text REFERENCES portfolios(id) ON DELETE SET NULL,
  strategy_id text REFERENCES portfolio_strategies(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  symbol text,
  reason text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual_effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_decision_journal_portfolio_time
  ON portfolio_decision_journal (portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_rankings (
  id text PRIMARY KEY,
  leaderboard text NOT NULL,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  score numeric(18, 8) NOT NULL,
  confidence numeric(8, 6) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(leaderboard, strategy_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_rankings_leaderboard_time
  ON portfolio_rankings (leaderboard, created_at DESC, rank);

COMMIT;
