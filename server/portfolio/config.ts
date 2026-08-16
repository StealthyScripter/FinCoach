export type PortfolioConfig = {
  enabled: boolean;
  researchEnabled: boolean;
  autostart: boolean;
  liveExecutionEnabled: false;
  startingCapital: number;
  maxActiveStrategies: number;
  marketDataProvider: "fixture" | "none";
  providerCallBudget: number;
  rebalanceThresholdPct: number;
};

export function loadPortfolioConfig(env: NodeJS.ProcessEnv = process.env): PortfolioConfig {
  const liveExecutionEnabled = env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED === "true";
  if (liveExecutionEnabled) throw new Error("FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED must remain false.");
  return {
    enabled: env.FINCOACH_PORTFOLIO_ENABLED === "true",
    researchEnabled: env.FINCOACH_PORTFOLIO_RESEARCH_ENABLED === "true",
    autostart: env.FINCOACH_PORTFOLIO_AUTOSTART === "true",
    liveExecutionEnabled: false,
    startingCapital: parsePositiveMoney(env.FINCOACH_PORTFOLIO_STARTING_CAPITAL, 100_000, "FINCOACH_PORTFOLIO_STARTING_CAPITAL"),
    maxActiveStrategies: parsePositiveInt(env.FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES, 20, "FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES"),
    marketDataProvider: env.FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER === "fixture" ? "fixture" : "none",
    providerCallBudget: parsePositiveInt(env.FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET, 250, "FINCOACH_PORTFOLIO_PROVIDER_CALL_BUDGET"),
    rebalanceThresholdPct: parsePositiveMoney(env.FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT, 5, "FINCOACH_PORTFOLIO_REBALANCE_THRESHOLD_PCT"),
  };
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
