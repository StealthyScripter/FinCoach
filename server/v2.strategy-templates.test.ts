import assert from "node:assert/strict";
import { activeFxResearchSession } from "./v2/fxResearchSessions";
import { resolveResearchInstrument } from "./v2/researchUniverse";
import { STRATEGY_TEMPLATES, classifyRegimeFromObservation, compatibleStrategyTemplates, instantiateStrategyTemplates, strategyTemplateInventory } from "./v2/strategyTemplates";
import { rulesV2Compiler } from "./v2/rules";

const eur = resolveResearchInstrument("EUR_USD");
assert.ok(eur);
const london = activeFxResearchSession(new Date("2026-08-11T08:15:00.000Z"), ["EUR_USD", "GBP_USD", "USD_JPY"]);
assert.equal(london?.sessionId, "london_morning");
const correlationId = "00000000-0000-4000-8000-000000000001";
const causationId = "00000000-0000-4000-8000-000000000002";

const inventory = strategyTemplateInventory();
assert.equal(inventory.totalTemplates, STRATEGY_TEMPLATES.length);
assert.equal((inventory.byFamily as Record<string, number>).trend, 2);
assert.equal((inventory.byFamily as Record<string, number>).breakout, 3);
assert.equal((inventory.byFamily as Record<string, number>).reversal_liquidity, 2);
assert.equal((inventory.byFamily as Record<string, number>).mean_reversion, 1);
assert.equal((inventory.byFamily as Record<string, number>).news_macro, 1);
assert.equal((inventory.byFamily as Record<string, number>).relative_value, 2);
assert.ok(STRATEGY_TEMPLATES.find(template => template.templateId === "news_macro.cpi_reaction")?.blockedReason?.includes("authoritative"));

const regime = classifyRegimeFromObservation("volatility_compression");
assert.equal(regime, "volatility_compression");
const compatible = compatibleStrategyTemplates({
  hypothesisId: "hypothesis-1",
  symbol: "EUR_USD",
  timeframe: "15m",
  observationType: "volatility_compression",
  detectorId: "volatility-compression",
  detectorVersion: "observation-detector.v1",
  instrument: eur,
  sessionId: "london_morning",
  regime,
  correlationId,
  causationId,
  createdAt: "2026-08-11T08:15:00.000Z",
});
assert.ok(compatible.some(template => template.templateId === "breakout.volatility_compression_breakout"));
assert.ok(compatible.every(template => template.instantiationStatus === "enabled"));

const instantiated = instantiateStrategyTemplates({
  hypothesisId: "hypothesis-1",
  symbol: "EUR_USD",
  timeframe: "15m",
  observationType: "volatility_compression",
  detectorId: "volatility-compression",
  detectorVersion: "observation-detector.v1",
  instrument: eur,
  sessionId: "london_morning",
  regime,
  correlationId,
  causationId,
  createdAt: "2026-08-11T08:15:00.000Z",
  limits: { maxTemplatesPerSymbolSession: 2, maxVariantsPerTemplate: 1 },
});
assert.equal(instantiated.length, 2);
assert.ok(instantiated.every(input => input.sessionRestrictions.some(rule => rule.field === "sessionId")));
assert.ok(instantiated.every(input => input.requiredFeatureDefinitions.some(feature => feature.featureId.startsWith("template:"))));

const renamed = { ...instantiated[0], name: "Different display name", correlationId: "00000000-0000-4000-8000-000000000003", causationId: "00000000-0000-4000-8000-000000000004", createdAt: "2026-08-11T09:15:00.000Z" };
const compiledA = rulesV2Compiler.compile(instantiated[0]).strategy;
const compiledB = rulesV2Compiler.compile(renamed).strategy;
assert.ok(compiledA);
assert.ok(compiledB);
assert.equal(compiledA.strategyId, compiledB.strategyId);
assert.equal(compiledA.fingerprint, compiledB.fingerprint);

const blockedRelativeValue = instantiateStrategyTemplates({
  hypothesisId: "hypothesis-2",
  symbol: "EUR_GBP",
  timeframe: "15m",
  observationType: "relative_strength_divergence",
  detectorId: "cross-pair-relative-strength",
  detectorVersion: "research-feature.v1",
  instrument: resolveResearchInstrument("EUR_GBP")!,
  sessionId: "london_morning",
  regime: "risk_on",
  correlationId,
  causationId,
  createdAt: "2026-08-11T08:15:00.000Z",
});
assert.equal(blockedRelativeValue.length, 0);

console.log("v2 strategy template tests passed");
