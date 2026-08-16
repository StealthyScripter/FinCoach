import assert from "node:assert/strict";
import { portfolioReadiness } from "./portfolio/readiness";
import { FixturePortfolioMarketDataProvider, NoPortfolioMarketDataProvider } from "./portfolio/marketData";

const base = {
  enabled: true,
  researchEnabled: true,
  autostart: true,
  liveExecutionEnabled: false,
  startingCapital: 100_000,
  maxActiveStrategies: 40,
  marketDataProvider: "alpha_vantage" as const,
  alphaVantageApiKey: "SET",
  providerTimeoutMs: 1_000,
  providerCacheTtlMs: 1_000,
  quoteFreshnessMaxMinutes: 1440,
  fixtureAllowedInProduction: false,
  providerCallBudget: 100,
  rebalanceThresholdPct: 5,
};

const realProvider = new FixturePortfolioMarketDataProvider();
const ready = portfolioReadiness({ config: base, provider: { ...realProvider, capabilities: () => ({ ...realProvider.capabilities(), fixture: false, live: true, options: true }) }, blockers: [], env: { FINCOACH_AUTH_REQUIRED: "true", DATABASE_URL: "postgres://local/test" } as NodeJS.ProcessEnv });
assert.equal(ready.codeReady, true);
assert.equal(ready.configReady, true);
assert.equal(ready.providerReady, true);
assert.equal(ready.activationReady, true);
assert.equal(ready.status, "ready");

const missingSecret = portfolioReadiness({ config: { ...base, alphaVantageApiKey: null }, provider: new NoPortfolioMarketDataProvider(), blockers: [], env: {} as NodeJS.ProcessEnv });
assert.equal(missingSecret.codeReady, false);
assert.equal(missingSecret.configReady, false);
assert.equal(missingSecret.activationReady, false);
assert.ok(missingSecret.blockers.some((blocker) => blocker.code === "portfolio_config_not_ready"));
