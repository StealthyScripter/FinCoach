export type PortfolioConfig = {
  enabled: boolean;
  researchEnabled: boolean;
  autostart: boolean;
  liveExecutionEnabled: false;
  startingCapital: number;
  maxActiveStrategies: number;
  marketDataProvider: "alpha_vantage" | "fixture" | "none";
  alphaVantageApiKey: string | null;
  providerTimeoutMs: number;
  providerCacheTtlMs: number;
  quoteFreshnessMaxMinutes: number;
  fixtureAllowedInProduction: boolean;
  providerCallBudget: number;
  rebalanceThresholdPct: number;
};

export function loadPortfolioConfig(env: NodeJS.ProcessEnv = process.env): PortfolioConfig {
  const liveExecutionEnabled = env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED === "true";
  if (liveExecutionEnabled) throw new Error("FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED must remain false.");
  const marketDataProvider = parseProvider(env.FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER);
  const fixtureAllowedInProduction = env.FINCOACH_PORTFOLIO_ALLOW_FIXTURE_PROVIDER === "true";
  if (env.NODE_ENV === "production" && env.FINCOACH_PORTFOLIO_ENABLED === "true" && marketDataProvider === "fixture" && !fixtureAllowedInProduction) {
    throw new Error("FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=fixture is not allowed for production Portfolio activation.");
  }
  if (env.FINCOACH_PORTFOLIO_ENABLED === "true" && marketDataProvider === "alpha_vantage" && !env.ALPHA_VANTAGE_API_KEY?.trim()) {
    throw new Error("ALPHA_VANTAGE_API_KEY is required when FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=alpha_vantage.");
  }
  return {
    enabled: env.FINCOACH_PORTFOLIO_ENABLED === "true",
    researchEnabled: env.FINCOACH_PORTFOLIO_RESEARCH_ENABLED === "true",
    autostart: env.FINCOACH_PORTFOLIO_AUTOSTART === "true",
    liveExecutionEnabled: false,
    startingCapital: parsePositiveMoney(env.FINCOACH_PORTFOLIO_STARTING_CAPITAL, 100_000, "FINCOACH_PORTFOLIO_STARTING_CAPITAL"),
    maxActiveStrategies: parsePositiveInt(env.FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES, 20, "FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES"),
    marketDataProvider,
    alphaVantageApiKey: env.ALPHA_VANTAGE_API_KEY?.trim() || null,
    providerTimeoutMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_TIMEOUT_MS, 10_000, "FINCOACH_PORTFOLIO_PROVIDER_TIMEOUT_MS"),
    providerCacheTtlMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_CACHE_TTL_MS, 60_000, "FINCOACH_PORTFOLIO_PROVIDER_CACHE_TTL_MS"),
    quoteFreshnessMaxMinutes: parsePositiveInt(env.FINCOACH_PORTFOLIO_QUOTE_FRESHNESS_MAX_MINUTES, 1440, "FINCOACH_PORTFOLIO_QUOTE_FRESHNESS_MAX_MINUTES"),
    fixtureAllowedInProduction,
    providerCallBudget: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET, 250, "FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET"),
    rebalanceThresholdPct: parsePositiveMoney(env.FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT, 5, "FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT"),
  };
}

function parseProvider(value: string | undefined): PortfolioConfig["marketDataProvider"] {
  if (value === "alpha_vantage") return "alpha_vantage";
  if (value === "fixture") return "fixture";
  return "none";
}

function parsePositiveMoney(value: string | undefined, fallback: number, key: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${key} must be a positive finite number.`);
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number, key: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer.`);
  return parsed;
}
