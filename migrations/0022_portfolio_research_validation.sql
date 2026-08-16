BEGIN;

CREATE TABLE IF NOT EXISTS portfolio_research_hypotheses (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id) ON DELETE CASCADE,
  hypothesis text NOT NULL,
  symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_window_start timestamptz NOT NULL,
  evidence_window_end timestamptz NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_research_hypotheses_strategy_time
  ON portfolio_research_hypotheses (strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_backtests (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id) ON DELETE CASCADE,
  hypothesis_id text NOT NULL REFERENCES portfolio_research_hypotheses(id) ON DELETE CASCADE,
  train_start timestamptz NOT NULL,
  train_end timestamptz NOT NULL,
  validation_start timestamptz NOT NULL,
  validation_end timestamptz NOT NULL,
  total_return_pct numeric(18, 8) NOT NULL,
  benchmark_return_pct numeric(18, 8) NOT NULL,
  max_drawdown_pct numeric(18, 8) NOT NULL,
  volatility_pct numeric(18, 8),
  sharpe numeric(18, 8),
  turnover_pct numeric(18, 8) NOT NULL,
  observations integer NOT NULL,
  passed boolean NOT NULL,
  rejection_reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtests_strategy_time
  ON portfolio_backtests (strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_walk_forward_results (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id) ON DELETE CASCADE,
  backtest_id text NOT NULL REFERENCES portfolio_backtests(id) ON DELETE CASCADE,
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  stability_score numeric(18, 8) NOT NULL,
  passed boolean NOT NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_walk_forward_strategy_time
  ON portfolio_walk_forward_results (strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_forward_tests (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES portfolio_strategies(id) ON DELETE CASCADE,
  portfolio_id text NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  decision text NOT NULL,
  symbol text NOT NULL,
  observed_price numeric(18, 8) NOT NULL,
  assumed_fill_price numeric(18, 8),
  quantity numeric(24, 8),
  nav numeric(18, 4) NOT NULL,
  cash numeric(18, 4) NOT NULL,
  risk_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(strategy_id, portfolio_id, observed_at, symbol)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_forward_tests_portfolio_time
  ON portfolio_forward_tests (portfolio_id, observed_at DESC);

COMMIT;
