import assert from "node:assert/strict";
import { marketSessionsService } from "./marketSessionsService";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { buildObservationPlan, configuredObservationDetectors } from "./v2/runtime/composition";
import { activeFxResearchSession, fxResearchSessions } from "./v2/fxResearchSessions";
import { DEFAULT_RESEARCH_SYMBOLS, RESEARCH_INSTRUMENT_CANDIDATE_AUDIT, parseResearchSymbols, resolveResearchInstrument, validateResearchUniverse } from "./v2/researchUniverse";

const baseEnv = {
  FINCOACH_V2_RUNTIME_ENABLED: "false",
  FINCOACH_V2_RESEARCH_ENABLED: "false",
  FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_TELEGRAM_TRANSPORT: "disabled",
} as NodeJS.ProcessEnv;

assert.equal(DEFAULT_RESEARCH_SYMBOLS.length, 26);
assert.deepEqual(DEFAULT_RESEARCH_SYMBOLS.slice(0, 7), ["EUR_USD", "GBP_USD", "AUD_USD", "NZD_USD", "USD_JPY", "USD_CHF", "USD_CAD"]);
assert.equal(RESEARCH_INSTRUMENT_CANDIDATE_AUDIT.filter(item => item.accepted).length, 26);
assert.equal(RESEARCH_INSTRUMENT_CANDIDATE_AUDIT.find(item => item.symbol === "USD_CNH")?.accepted, false);
assert.equal(parseResearchSymbols("EUR/USD, eur_usd, XAU-USD").join(","), "EUR_USD,XAU_USD");
assert.equal(resolveResearchInstrument("EUR/USD")?.providerSymbol, "EUR_USD");
assert.equal(resolveResearchInstrument("AUD/CAD")?.providerSymbol, "AUD_CAD");
assert.equal(resolveResearchInstrument("WTI")?.providerSymbol, "WTICO_USD");
assert.equal(resolveResearchInstrument("BTC_USD"), null);

{
  const config = loadV2RuntimeConfig(baseEnv).config;
  assert.equal(config.symbols.length, 26);
  const universe = validateResearchUniverse(config.symbols);
  assert.equal(universe.counts.configured, 26);
  assert.equal(universe.counts.validated, 26);
  assert.equal(universe.counts.unsupported, 0);
  assert.deepEqual(universe.counts.byAssetClass, { forex: 26 });
  assert.deepEqual(universe.counts.bySession, { "FX Global": 26 });
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

{
  const tokyo = activeFxResearchSession(new Date("2026-08-11T01:30:00.000Z"), DEFAULT_RESEARCH_SYMBOLS);
  assert.equal(tokyo?.sessionId, "tokyo");
  assert.ok(tokyo?.prioritySymbols.includes("USD_JPY"));
  assert.ok(tokyo?.compatibleConfiguredSymbols.includes("AUD_JPY"));
  const overlap = activeFxResearchSession(new Date("2026-08-11T13:00:00.000Z"), DEFAULT_RESEARCH_SYMBOLS);
  assert.equal(overlap?.sessionId, "london_new_york_overlap");
  assert.ok(overlap?.prioritySymbols.includes("USD_CAD"));
  const dst = fxResearchSessions(new Date("2026-03-29T13:00:00.000Z"), DEFAULT_RESEARCH_SYMBOLS);
  assert.equal(dst.filter(session => session.active).length, 1);
  assert.equal(dst.find(session => session.active)?.sessionQuality, "partial");
}

console.log("v2 research universe tests passed");
