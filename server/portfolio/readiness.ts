import type { PortfolioConfig } from "./config";
import type { PortfolioMarketDataProvider } from "./marketData";
import type { PortfolioReadiness } from "./domain";

export function portfolioReadiness(input: { config: PortfolioConfig; provider: PortfolioMarketDataProvider; blockers: Array<Record<string, unknown>>; env?: NodeJS.ProcessEnv }): PortfolioReadiness & {
  codeReady: boolean;
  configReady: boolean;
  providerReady: boolean;
  runtimeReady: boolean;
  activationReady: boolean;
} {
  const env = input.env ?? process.env;
  const capabilities = input.provider.capabilities();
  const softwareCapabilities = ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "OPTIONS_CHAIN", "MARKET_STATUS"] as const;
  const codeReady = softwareCapabilities.every((capability) => capabilities.capabilities.includes(capability) || capability === "OPTIONS_CHAIN");
  const authReady = env.FINCOACH_AUTH_REQUIRED !== "false";
  const configReady = input.config.enabled
    && input.config.liveExecutionEnabled === false
    && input.config.marketDataProvider === "alpha_vantage"
    && Boolean(input.config.alphaVantageApiKey);
  const providerReady = capabilities.live && !capabilities.fixture && capabilities.latestQuote && capabilities.historical;
  const runtimeReady = input.blockers.length === 0;
  const blockers = [
    ...input.blockers.map((item) => ({ code: String(item.code ?? "portfolio_blocker"), action: String(item.action ?? "Resolve Portfolio blocker.") })),
  ];
  if (!configReady) blockers.push({ code: "portfolio_config_not_ready", action: "Set FINCOACH_PORTFOLIO_ENABLED=true, FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER=alpha_vantage, ALPHA_VANTAGE_API_KEY, and keep FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED=false." });
  if (!providerReady) blockers.push({ code: "portfolio_provider_not_verified", action: "Verify real provider health and capabilities before activation." });
  return {
    status: codeReady && configReady && providerReady && runtimeReady ? "ready" : "not_ready",
    codeReady,
    configReady,
    providerReady,
    runtimeReady,
    activationReady: codeReady && configReady && providerReady && runtimeReady,
    marketDataReady: providerReady,
    researchReady: providerReady,
    validationReady: providerReady,
    virtualForwardReady: providerReady,
    authReady,
    persistenceReady: Boolean(env.DATABASE_URL),
    liveExecutionBlocked: true,
    blockers,
  };
}
