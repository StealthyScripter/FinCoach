export type PortfolioConfig = {
  enabled: boolean;
  researchEnabled: boolean;
  autostart: boolean;
  liveExecutionEnabled: false;
  startingCapital: number;
  maxActiveStrategies: number;
  marketDataProvider: PortfolioMarketDataProviderKind;
  marketDataProviders: PortfolioMarketDataProviderKind[];
  alphaVantageApiKey: string | null;
  twelveDataApiKey: string | null;
  providerTimeoutMs: number;
  providerCacheTtlMs: number;
  quoteFreshnessMaxMinutes: number;
  fixtureAllowedInProduction: boolean;
  providerCallBudget: number;
  cacheEnabled: boolean;
  cacheMaxEntries: number;
  cacheMaxBytes: number | null;
  cachePruneIntervalMs: number;
  cacheExpiredRetentionMs: number;
  rebalanceThresholdPct: number;
};

export type PortfolioMarketDataProviderKind = "twelve_data" | "alpha_vantage" | "fixture" | "none";

export function loadPortfolioConfig(env: NodeJS.ProcessEnv = process.env): PortfolioConfig {
  const liveExecutionEnabled = env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED === "true";
  if (liveExecutionEnabled) throw new Error("FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED must remain false.");
  const marketDataProviders = parseProviders(env.FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDERS, env.FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER);
  const marketDataProvider = marketDataProviders[0] ?? "none";
  const fixtureAllowedInProduction = env.FINCOACH_PORTFOLIO_ALLOW_FIXTURE_PROVIDER === "true";
  if (env.NODE_ENV === "production" && env.FINCOACH_PORTFOLIO_ENABLED === "true" && marketDataProviders.includes("fixture") && !fixtureAllowedInProduction) {
    throw new Error("FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=fixture is not allowed for production Portfolio activation.");
  }
  if (env.FINCOACH_PORTFOLIO_ENABLED === "true" && marketDataProviders.includes("alpha_vantage") && !env.ALPHA_VANTAGE_API_KEY?.trim()) {
    throw new Error("ALPHA_VANTAGE_API_KEY is required when FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=alpha_vantage.");
  }
  if (env.FINCOACH_PORTFOLIO_ENABLED === "true" && marketDataProviders.includes("twelve_data") && !env.TWELVE_DATA_API_KEY?.trim()) {
    throw new Error("TWELVE_DATA_API_KEY is required when FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=twelve_data.");
  }
  return {
    enabled: env.FINCOACH_PORTFOLIO_ENABLED === "true",
    researchEnabled: env.FINCOACH_PORTFOLIO_RESEARCH_ENABLED === "true",
    autostart: env.FINCOACH_PORTFOLIO_AUTOSTART === "true",
    liveExecutionEnabled: false,
    startingCapital: parsePositiveMoney(env.FINCOACH_PORTFOLIO_STARTING_CAPITAL, 100_000, "FINCOACH_PORTFOLIO_STARTING_CAPITAL"),
    maxActiveStrategies: parsePositiveInt(env.FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES, 20, "FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES"),
    marketDataProvider,
    marketDataProviders,
    alphaVantageApiKey: env.ALPHA_VANTAGE_API_KEY?.trim() || null,
    twelveDataApiKey: env.TWELVE_DATA_API_KEY?.trim() || null,
    providerTimeoutMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_TIMEOUT_MS, 10_000, "FINCOACH_PORTFOLIO_PROVIDER_TIMEOUT_MS"),
    providerCacheTtlMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_CACHE_TTL_MS, 60_000, "FINCOACH_PORTFOLIO_PROVIDER_CACHE_TTL_MS"),
    quoteFreshnessMaxMinutes: parsePositiveInt(env.FINCOACH_PORTFOLIO_QUOTE_FRESHNESS_MAX_MINUTES, 1440, "FINCOACH_PORTFOLIO_QUOTE_FRESHNESS_MAX_MINUTES"),
    fixtureAllowedInProduction,
    providerCallBudget: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET, 250, "FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET"),
    cacheEnabled: env.FINCOACH_PORTFOLIO_CACHE_ENABLED !== "false",
    cacheMaxEntries: parsePositiveInt(env.FINCOACH_PORTFOLIO_CACHE_MAX_ENTRIES, 2_000, "FINCOACH_PORTFOLIO_CACHE_MAX_ENTRIES"),
    cacheMaxBytes: env.FINCOACH_PORTFOLIO_CACHE_MAX_BYTES ? parsePositiveInt(env.FINCOACH_PORTFOLIO_CACHE_MAX_BYTES, 50_000_000, "FINCOACH_PORTFOLIO_CACHE_MAX_BYTES") : null,
    cachePruneIntervalMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_CACHE_PRUNE_INTERVAL_MS, 3_600_000, "FINCOACH_PORTFOLIO_CACHE_PRUNE_INTERVAL_MS"),
    cacheExpiredRetentionMs: parsePositiveInt(env.FINCOACH_PORTFOLIO_CACHE_EXPIRED_RETENTION_MS, 86_400_000, "FINCOACH_PORTFOLIO_CACHE_EXPIRED_RETENTION_MS"),
    rebalanceThresholdPct: parsePositiveMoney(env.FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT, 5, "FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT"),
  };
}

function parseProviders(values: string | undefined, single: string | undefined): PortfolioMarketDataProviderKind[] {
  const raw = values?.trim() ? values : single;
  const parsed = (raw ?? "none").split(",").map((item) => parseProvider(item.trim())).filter((item, index, all) => all.indexOf(item) === index);
  return parsed.length ? parsed : ["none"];
}

function parseProvider(value: string | undefined): PortfolioMarketDataProviderKind {
  if (value === "twelve_data") return "twelve_data";
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
