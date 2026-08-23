export type OperationalAlertCategory =
  | "EXPECTED_POLICY_REJECTION"
  | "CONFIGURATION_FAILURE"
  | "AUTHENTICATION_FAILURE"
  | "PROVIDER_FAILURE"
  | "MARKET_DATA_FAILURE"
  | "MARKET_DATA_FALLBACK"
  | "BROKER_RECONCILIATION_FAILURE"
  | "BROKER_STATE_MISMATCH"
  | "EXECUTION_INFRASTRUCTURE_FAILURE"
  | "SAFETY_ENVIRONMENT_FAILURE"
  | "SYSTEM_HEALTH_FAILURE";

export type OperationalAlertEvent = {
  code: string;
  kind?: string;
  expected?: boolean;
  category?: OperationalAlertCategory;
  provider?: string | null;
  broker?: string | null;
  symbol?: string | null;
  account?: string | null;
  environment?: string | null;
  configKey?: string | null;
};

const EXPECTED_POLICY_CODES = new Set([
  "rr_below_minimum",
  "spread_above_limit",
  "correlation_limit",
  "strategy_not_eligible",
  "court_verdict_rejected",
  "insufficient_evidence",
  "outside_trading_window",
  "confidence_below_threshold",
  "forward_test_candidate_rejected",
  "signal_candidate_rejected",
  "max_active_research_signals_reached",
  "max_active_research_signals_zero",
  "portfolio_max_active_strategies_reached",
  "confirmation_expired",
  "insufficient_margin",
  "order_rejected",
  "duplicate_signal",
  "stale_signal",
  "no_qualifying_setup",
  "normal_strategy_rejection",
  "strategy_validation_rejection",
  "market_closed",
  "weekend_market_closed",
  "major_news_blackout",
]);

const CONFIGURATION_CODES = new Set([
  "broker_not_configured",
  "broker_endpoint_missing",
  "database_url_missing",
  "required_config_missing",
  "execution_service_disabled_unexpectedly",
  "provider_credentials_missing",
  "market_data_provider_not_configured",
]);

const AUTHENTICATION_CODES = new Set([
  "broker_authentication_failed",
  "broker_account_unreachable",
  "provider_authentication_failed",
  "token_missing",
]);

const PROVIDER_CODES = new Set([
  "provider_unavailable",
  "provider_disconnected",
  "provider_rate_limited",
  "provider_budget_exhausted",
  "rate_limited",
  "provider_quota_exhausted",
]);

const OPERATOR_ACTIONABLE_CAPACITY_CODES = new Set([
  "max_daily_trade_capacity_reached",
  "max_daily_trades_reached",
  "max_concurrent_practice_trade_capacity_reached",
  "practice_active_trade_cap_reached",
  "open_positions_limit_reached",
  "account_exposure_capacity_reached",
  "global_exposure_capacity_reached",
  "risk_budget_exceeded",
  "max_active_forward_tests_reached",
  "max_active_forward_tests_zero",
  "kill_switch_active",
  "telegram_getupdates_conflict",
]);

const MARKET_DATA_CODES = new Set([
  "market_data_unavailable",
  "real_market_data_required",
  "stale_price",
  "fixture_market_data_blocked",
  "simulated_market_data_blocked",
  "synthetic_market_data_blocked",
  "required_market_data_unavailable",
]);

const RECONCILIATION_CODES = new Set([
  "reconciliation_failed",
  "reconciliation_stale",
  "broker_trade_missing",
  "broker_order_missing",
  "orphan_broker_trade",
  "broker_state_mismatch",
  "local_active_broker_missing",
  "local_pending_order_missing",
]);

const SAFETY_CODES = new Set([
  "practice_environment_mismatch",
  "demo_environment_required",
  "live_oanda_endpoint_rejected",
]);

export function classifyOperationalAlert(event: OperationalAlertEvent): OperationalAlertCategory {
  if (event.category) return event.category;
  const code = normalizeCode(event.code);
  if (OPERATOR_ACTIONABLE_CAPACITY_CODES.has(code)) return "EXECUTION_INFRASTRUCTURE_FAILURE";
  if (event.expected === true || EXPECTED_POLICY_CODES.has(code)) return "EXPECTED_POLICY_REJECTION";
  if (CONFIGURATION_CODES.has(code)) return "CONFIGURATION_FAILURE";
  if (AUTHENTICATION_CODES.has(code) || /auth|credential|token/.test(code)) return "AUTHENTICATION_FAILURE";
  if (RECONCILIATION_CODES.has(code) || /reconcil|broker_.*missing|missing_.*broker|orphan/.test(code)) {
    return code.includes("failed") || code.includes("stale") ? "BROKER_RECONCILIATION_FAILURE" : "BROKER_STATE_MISMATCH";
  }
  if (MARKET_DATA_CODES.has(code) || /market_data|fixture|simulated|synthetic|stale_price/.test(code)) return "MARKET_DATA_FAILURE";
  if (code.includes("fallback") || event.kind === "fallback") return "MARKET_DATA_FALLBACK";
  if (PROVIDER_CODES.has(code) || /provider|rate_limit|quota/.test(code)) return "PROVIDER_FAILURE";
  if (SAFETY_CODES.has(code) || /environment|live.*endpoint/.test(code)) return "SAFETY_ENVIRONMENT_FAILURE";
  if (/database|scheduler|worker|health/.test(code)) return "SYSTEM_HEALTH_FAILURE";
  return "EXECUTION_INFRASTRUCTURE_FAILURE";
}

export function shouldSendOperatorTelegramAlert(event: OperationalAlertEvent) {
  return classifyOperationalAlert(event) !== "EXPECTED_POLICY_REJECTION";
}

export function operatorIncidentKey(event: OperationalAlertEvent) {
  const category = classifyOperationalAlert(event);
  return [
    category,
    normalizeCode(event.code),
    event.provider ?? event.broker ?? "*",
    event.symbol ?? "*",
    event.account ?? "*",
    event.environment ?? "*",
    event.configKey ?? "*",
  ].map((part) => String(part).trim().toLowerCase()).join("|");
}

function normalizeCode(code: string) {
  return code.trim().toLowerCase();
}
