import assert from "node:assert/strict";
import { marketSessionsService } from "./marketSessionsService";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { buildObservationPlan, configuredObservationDetectors } from "./v2/runtime/composition";
import { DEFAULT_RESEARCH_SYMBOLS, parseResearchSymbols, resolveResearchInstrument, validateResearchUniverse } from "./v2/researchUniverse";

const baseEnv = {
  FINCOACH_V2_RUNTIME_ENABLED: "false",
  FINCOACH_V2_RESEARCH_ENABLED: "false",
  FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_TELEGRAM_TRANSPORT: "disabled",
} as NodeJS.ProcessEnv;

assert.deepEqual(DEFAULT_RESEARCH_SYMBOLS, ["EUR_USD", "GBP_USD", "USD_JPY", "XAU_USD", "XAG_USD", "WTICO_USD", "BCO_USD"]);
assert.equal(parseResearchSymbols("EUR/USD, eur_usd, XAU-USD").join(","), "EUR_USD,XAU_USD");
assert.equal(resolveResearchInstrument("EUR/USD")?.providerSymbol, "EUR_USD");
assert.equal(resolveResearchInstrument("WTI")?.providerSymbol, "WTICO_USD");
assert.equal(resolveResearchInstrument("BTC_USD"), null);

{
  const config = loadV2RuntimeConfig(baseEnv).config;
  assert.equal(config.symbols.length, 7);
  const universe = validateResearchUniverse(config.symbols);
  assert.equal(universe.counts.configured, 7);
  assert.equal(universe.counts.validated, 7);
  assert.equal(universe.counts.unsupported, 0);
  assert.deepEqual(universe.counts.byAssetClass, { forex: 3, commodity: 4 });
  assert.deepEqual(universe.counts.bySession, { "FX Global": 3, "Provider Metals and Energy": 4 });
}

{
  const validation = loadV2RuntimeConfig({
    ...baseEnv,
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "false",
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_SYMBOLS: "EUR_USD,BTC_USD,UNKNOWN_ASSET",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /BTC_USD/);
  assert.match(validation.errors.join("\n"), /UNKNOWN_ASSET/);
}

{
  const fridayAfterFxClose = new Date("2026-08-14T21:30:00.000Z");
  const sessions = marketSessionsService.instrumentSessions(["EUR_USD", "BTC_USD"], fridayAfterFxClose);
  assert.equal(sessions.find(item => item.symbol === "EUR_USD")?.status, "closed");
  assert.equal(sessions.find(item => item.symbol === "BTC_USD")?.status, "open");
  const aggregate = marketSessionsService.aggregateTradableWindow(fridayAfterFxClose, ["EUR_USD", "BTC_USD"]);
  assert.equal(aggregate.anyConfiguredInstrumentTradable, true);
  assert.deepEqual(aggregate.instrumentsRemainingOpen, ["BTC_USD"]);
  assert.equal(aggregate.finalWeeklyCloseAt, "2026-08-14T22:00:00.000Z");
}

{
  const detectors = configuredObservationDetectors().map(detector => detector.detectorId).sort();
  assert.deepEqual(detectors, ["breakout", "liquidity-sweep", "volatility-compression"]);
  const config = loadV2RuntimeConfig({ ...baseEnv, FINCOACH_V2_SYMBOLS: "EUR_USD,XAU_USD", FINCOACH_V2_TIMEFRAMES: "1m,15m" }).config;
  const plans = buildObservationPlan(config, ["XAU_USD"]);
  assert.ok(plans.every(plan => plan.symbol === "XAU_USD"));
  assert.ok(plans.some(plan => plan.detector.detectorId === "liquidity-sweep" && plan.timeframe === "15m"));
  assert.ok(!plans.some(plan => plan.detector.detectorId === "liquidity-sweep" && plan.timeframe === "1m"));
}

console.log("v2 research universe tests passed");
