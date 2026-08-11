import type { CompileStrategyInput, ExitRule, FeatureReference, RuleExpression } from "./rules";
import type { FxResearchSessionId } from "./fxResearchSessions";
import type { ResearchInstrumentRecord } from "./researchUniverse";

export type StrategyFamily = "trend" | "breakout" | "reversal_liquidity" | "mean_reversion" | "news_macro" | "relative_value";
export type ResearchRegime =
  | "trending"
  | "ranging"
  | "high_volatility"
  | "low_volatility"
  | "volatility_expansion"
  | "volatility_compression"
  | "news_event"
  | "post_news_normalization"
  | "risk_on"
  | "risk_off"
  | "unknown";

export type StrategyTemplate = {
  templateId: string;
  name: string;
  primaryFamily: StrategyFamily;
  tags: string[];
  compatibleAssetClasses: Array<ResearchInstrumentRecord["assetClass"]>;
  compatibleSymbols?: string[];
  compatibleSessionIds: Array<FxResearchSessionId | "fx" | "commodities">;
  compatibleTimeframes: string[];
  requiredDetectors: string[];
  requiredEvidenceTypes: string[];
  requiredFeatures: string[];
  compatibleRegimes: ResearchRegime[];
  prohibitedRegimes: ResearchRegime[];
  stopLoss: ExitRule;
  takeProfit: ExitRule;
  timeExit: ExitRule | null;
  parameterSearchSpace: Array<{ variantId: string; stopLoss: ExitRule; takeProfit: ExitRule; timeExit?: ExitRule | null; filters?: RuleExpression[] }>;
  minimumDataRequirements: { minObservations: number; minCandles: number };
  lineage: { source: "v2_strategy_template_registry"; version: string };
  researchOnly: true;
  multiSymbol: boolean;
  instantiationStatus: "enabled" | "blocked";
  blockedReason?: string;
};

export type TemplateInstantiationInput = {
  hypothesisId: string;
  symbol: string;
  timeframe: string;
  observationType: string;
  detectorId: string;
  detectorVersion: string;
  instrument: ResearchInstrumentRecord;
  sessionId: FxResearchSessionId | "fx" | "commodities";
  regime: ResearchRegime;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  limits?: {
    maxTemplatesPerSymbolSession?: number;
    maxVariantsPerTemplate?: number;
  };
};

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  template("trend.session_open_momentum", "Session-open momentum", "trend", ["momentum", "session_open"], ["breakout"], ["structure.breakOfStructure"], ["momentum", "market_structure_direction"], ["volatility_expansion", "trending"], ["frankfurt_london_open", "new_york_open", "tokyo"], ["5m", "15m", "30m"], [{ variantId: "atr_1_5_to_2r", stopLoss: atr(1.5), takeProfit: atr(2), timeExit: time("2h") }]),
  template("trend.market_structure_continuation", "Market-structure continuation", "trend", ["continuation"], ["breakout"], ["structure.breakOfStructure"], ["market_structure_direction", "trend_slope"], ["trending", "volatility_expansion"], ["tokyo", "london_morning", "london_new_york_overlap", "new_york_open"], ["15m", "30m", "1h"], [{ variantId: "atr_1_25_to_2r", stopLoss: atr(1.25), takeProfit: atr(2), timeExit: time("3h") }]),
  template("breakout.volatility_compression_breakout", "Volatility-compression breakout", "breakout", ["compression", "expansion"], ["volatility-compression", "breakout"], ["volatility.compression", "structure.breakOfStructure"], ["atr", "realized_volatility", "compression_ratio"], ["volatility_compression", "volatility_expansion"], ["tokyo", "london_morning", "london_new_york_overlap", "new_york_open"], ["15m", "30m", "1h"], [{ variantId: "atr_1_5_to_2r", stopLoss: atr(1.5), takeProfit: atr(2), timeExit: time("2h") }, { variantId: "atr_2_to_3r", stopLoss: atr(2), takeProfit: atr(3), timeExit: time("4h") }]),
  template("breakout.asian_range_breakout", "Asian-range breakout", "breakout", ["asia_range", "london_open"], ["volatility-compression", "breakout"], ["volatility.compression", "structure.breakOfStructure"], ["session_range_high_low", "atr"], ["volatility_compression", "volatility_expansion"], ["frankfurt_london_open", "london_morning"], ["15m", "30m"], [{ variantId: "atr_1_to_1_8r", stopLoss: atr(1), takeProfit: atr(1.8), timeExit: time("3h") }]),
  template("breakout.session_high_low_breakout", "Session-high-low breakout", "breakout", ["session_range"], ["breakout"], ["structure.breakOfStructure"], ["session_range_high_low", "opening_range"], ["volatility_expansion"], ["fx"], ["1m", "5m", "15m", "30m"], [{ variantId: "atr_1_25_to_2r", stopLoss: atr(1.25), takeProfit: atr(2), timeExit: time("2h") }]),
  template("reversal_liquidity.liquidity_sweep_reversal", "Liquidity-sweep reversal", "reversal_liquidity", ["sweep", "reclaim"], ["liquidity-sweep"], ["liquidity.sweep"], ["sweep_reclaim", "session_range_high_low"], ["high_volatility", "ranging"], ["late_asia", "frankfurt_london_open", "london_new_york_overlap", "new_york_open"], ["5m", "15m", "30m"], [{ variantId: "atr_1_to_1_5r", stopLoss: atr(1), takeProfit: atr(1.5), timeExit: time("90m") }]),
  template("reversal_liquidity.london_false_breakout", "London false breakout", "reversal_liquidity", ["false_breakout", "london"], ["liquidity-sweep"], ["liquidity.sweep"], ["sweep_reclaim", "session_range_high_low"], ["high_volatility", "ranging"], ["frankfurt_london_open", "london_morning"], ["5m", "15m"], [{ variantId: "atr_1_to_2r", stopLoss: atr(1), takeProfit: atr(2), timeExit: time("2h") }]),
  template("mean_reversion.session_range_extreme", "Session-range extreme reversion", "mean_reversion", ["range", "extreme"], ["liquidity-sweep"], ["liquidity.sweep"], ["session_range_high_low", "z_score"], ["ranging", "high_volatility"], ["late_asia", "new_york_afternoon"], ["15m", "30m"], [{ variantId: "atr_1_to_midrange", stopLoss: atr(1), takeProfit: { type: "price_level", value: "session_mid" }, timeExit: time("2h") }]),
  blockedTemplate("news_macro.cpi_reaction", "CPI reaction", "news_macro", ["macro", "event"], ["authoritative_event", "event_surprise"], "Requires authoritative economic-event provenance; synthetic/demo events are not eligible."),
  blockedTemplate("relative_value.eur_gbp_relative_strength", "EUR/GBP relative-strength divergence", "relative_value", ["multi_symbol", "relative_strength"], ["cross_pair_relative_strength", "correlation_divergence"], "Requires explicit multi-symbol feature lineage; current V2 runtime does not yet persist cross-pair relative-value observations."),
  blockedTemplate("relative_value.aud_nzd_relative_strength", "AUD/NZD relative-strength divergence", "relative_value", ["multi_symbol", "relative_strength"], ["cross_pair_relative_strength", "correlation_divergence"], "Requires explicit multi-symbol feature lineage; current V2 runtime does not yet persist cross-pair relative-value observations."),
];

export function classifyRegimeFromObservation(observationType: string): ResearchRegime {
  if (/compression/i.test(observationType)) return "volatility_compression";
  if (/breakout/i.test(observationType)) return "volatility_expansion";
  if (/liquidity|sweep/i.test(observationType)) return "high_volatility";
  return "unknown";
}

export function compatibleStrategyTemplates(input: TemplateInstantiationInput) {
  const enabled = STRATEGY_TEMPLATES.filter(template => template.instantiationStatus === "enabled")
    .filter(template => template.compatibleAssetClasses.includes(input.instrument.assetClass))
    .filter(template => !template.compatibleSymbols || template.compatibleSymbols.includes(input.symbol))
    .filter(template => template.compatibleSessionIds.includes(input.sessionId) || template.compatibleSessionIds.includes(input.instrument.sessionGroup))
    .filter(template => template.compatibleTimeframes.includes(input.timeframe))
    .filter(template => template.requiredDetectors.includes(input.detectorId))
    .filter(template => template.compatibleRegimes.includes(input.regime) || input.regime === "unknown")
    .filter(template => !template.prohibitedRegimes.includes(input.regime));
  return enabled.slice(0, input.limits?.maxTemplatesPerSymbolSession ?? 3);
}

export function instantiateStrategyTemplates(input: TemplateInstantiationInput): CompileStrategyInput[] {
  const templates = compatibleStrategyTemplates(input);
  return templates.flatMap(template => template.parameterSearchSpace.slice(0, input.limits?.maxVariantsPerTemplate ?? 1).map((variant): CompileStrategyInput => ({
    hypothesisId: input.hypothesisId,
    name: `${template.name} ${input.symbol} ${input.timeframe} ${input.sessionId} ${variant.variantId}`,
    assetClasses: [input.instrument.assetClass],
    symbols: [input.symbol],
    timeframes: [input.timeframe],
    entryConditions: [
      { field: "templateId", operator: "==", value: template.templateId },
      { field: "observationType", operator: "in", value: [input.observationType] },
      { field: "sessionId", operator: "in", value: [input.sessionId] },
      { field: "parameterVariant", operator: "==", value: variant.variantId },
    ],
    filters: [
      { field: "primaryFamily", operator: "==", value: template.primaryFamily },
      { field: "regime", operator: "in", value: template.compatibleRegimes },
      ...(variant.filters ?? []),
    ],
    sidePolicy: { candidateSide: "both" },
    stopLoss: variant.stopLoss,
    takeProfit: variant.takeProfit,
    timeExit: variant.timeExit === undefined ? template.timeExit : variant.timeExit,
    invalidationRules: [{ field: "spread", operator: "<", value: 0.01 }],
    positionSizing: { type: "fixed_fractional", riskFraction: 0.001 },
    costModel: { costModelId: "deterministic-demo-costs", version: "v1" },
    sessionRestrictions: [{ field: "sessionId", operator: "in", value: [input.sessionId] }],
    eventRestrictions: template.primaryFamily === "news_macro" ? [{ field: "eventProvenance", operator: "==", value: "authoritative" }] : [],
    supportedRegimes: template.compatibleRegimes,
    requiredFeatureDefinitions: featureReferences(template, input),
    correlationId: input.correlationId,
    causationId: input.causationId,
    createdAt: input.createdAt,
  })));
}

export function strategyTemplateInventory() {
  const byFamily = countBy(STRATEGY_TEMPLATES, template => template.primaryFamily);
  const byStatus = countBy(STRATEGY_TEMPLATES, template => template.instantiationStatus);
  const bySession = countBy(STRATEGY_TEMPLATES.flatMap(template => template.compatibleSessionIds.map(session => ({ session }))), item => item.session);
  return {
    source: "v2_strategy_template_registry",
    totalTemplates: STRATEGY_TEMPLATES.length,
    enabledTemplates: STRATEGY_TEMPLATES.filter(template => template.instantiationStatus === "enabled").length,
    blockedTemplates: STRATEGY_TEMPLATES.filter(template => template.instantiationStatus === "blocked").length,
    byFamily,
    byStatus,
    byCompatibleSession: bySession,
    templates: STRATEGY_TEMPLATES.map(template => ({
      templateId: template.templateId,
      name: template.name,
      primaryFamily: template.primaryFamily,
      tags: template.tags,
      compatibleSessionIds: template.compatibleSessionIds,
      compatibleRegimes: template.compatibleRegimes,
      requiredDetectors: template.requiredDetectors,
      instantiationStatus: template.instantiationStatus,
      blockedReason: template.blockedReason ?? null,
      researchOnly: template.researchOnly,
      multiSymbol: template.multiSymbol,
    })),
  };
}

function template(
  templateId: string,
  name: string,
  primaryFamily: StrategyFamily,
  tags: string[],
  requiredDetectors: string[],
  requiredEvidenceTypes: string[],
  requiredFeatures: string[],
  compatibleRegimes: ResearchRegime[],
  compatibleSessionIds: StrategyTemplate["compatibleSessionIds"],
  compatibleTimeframes: string[],
  parameterSearchSpace: StrategyTemplate["parameterSearchSpace"],
): StrategyTemplate {
  return {
    templateId,
    name,
    primaryFamily,
    tags,
    compatibleAssetClasses: ["forex"],
    compatibleSessionIds,
    compatibleTimeframes,
    requiredDetectors,
    requiredEvidenceTypes,
    requiredFeatures,
    compatibleRegimes,
    prohibitedRegimes: ["news_event"],
    stopLoss: parameterSearchSpace[0].stopLoss,
    takeProfit: parameterSearchSpace[0].takeProfit,
    timeExit: parameterSearchSpace[0].timeExit ?? null,
    parameterSearchSpace,
    minimumDataRequirements: { minObservations: 2, minCandles: 40 },
    lineage: { source: "v2_strategy_template_registry", version: "2026-08-11" },
    researchOnly: true,
    multiSymbol: false,
    instantiationStatus: "enabled",
  };
}

function blockedTemplate(templateId: string, name: string, primaryFamily: StrategyFamily, tags: string[], requiredFeatures: string[], blockedReason: string): StrategyTemplate {
  return {
    templateId,
    name,
    primaryFamily,
    tags,
    compatibleAssetClasses: ["forex"],
    compatibleSessionIds: ["fx"],
    compatibleTimeframes: ["15m", "30m", "1h"],
    requiredDetectors: [],
    requiredEvidenceTypes: [],
    requiredFeatures,
    compatibleRegimes: primaryFamily === "news_macro" ? ["news_event", "post_news_normalization"] : ["risk_on", "risk_off", "unknown"],
    prohibitedRegimes: [],
    stopLoss: atr(1),
    takeProfit: atr(1),
    timeExit: null,
    parameterSearchSpace: [],
    minimumDataRequirements: { minObservations: 0, minCandles: 0 },
    lineage: { source: "v2_strategy_template_registry", version: "2026-08-11" },
    researchOnly: true,
    multiSymbol: primaryFamily === "relative_value",
    instantiationStatus: "blocked",
    blockedReason,
  };
}

function featureReferences(template: StrategyTemplate, input: TemplateInstantiationInput): FeatureReference[] {
  const features = new Set([input.detectorId, ...template.requiredFeatures, ...template.requiredEvidenceTypes, `template:${template.templateId}`]);
  return [...features].map(featureId => ({ featureId, version: featureId === input.detectorId ? input.detectorVersion : "research-feature.v1" }));
}

function atr(value: number): ExitRule {
  return { type: "atr_multiple", value };
}

function time(value: string): ExitRule {
  return { type: "time", value };
}

function countBy<T>(items: T[], keyOf: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
  return counts;
}
