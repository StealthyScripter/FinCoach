import type { FeatureDefinition } from "./contracts";

export const featureDefinitions: FeatureDefinition[] = [
  ["rsi_percentile", ["momentum.rsi"], 5, "Rolling RSI percentile"],
  ["atr_zscore", ["volatility.atr"], 5, "ATR z-score versus recent baseline"],
  ["atr_robust_zscore", ["volatility.atr"], 5, "ATR robust z-score using median and MAD"],
  ["momentum_acceleration", ["momentum.acceleration"], 3, "Momentum acceleration"],
  ["volume_relative_session", ["participation.relativeVolume", "context.activeSession"], 3, "Relative volume conditioned by session"],
  ["range_regime_percentile", ["volatility.rangePercentile", "context.trendRangeRegime"], 3, "Range percentile within current regime"],
  ["vwap_distance_atr", ["participation.distanceFromVwap", "volatility.atr"], 1, "VWAP distance normalized by ATR"],
  ["timeframe_alignment_score", ["structure.trend", "context.higherTimeframeDirection"], 1, "Lower and higher timeframe alignment score"],
  ["abnormal_return_score", ["momentum.rateOfChange", "volatility.realizedVolatility"], 5, "Return abnormality adjusted for realized volatility"],
  ["liquidity_stress_score", ["liquidity.sweep", "context.liquidityState", "context.spreadState"], 1, "Liquidity stress score"],
].map(([featureId, inputs, warmupPeriods, description]) => ({
  featureId: String(featureId),
  version: "feature-engineering.v1",
  description: String(description),
  inputs: inputs as string[],
  warmupPeriods: Number(warmupPeriods),
  supportedTimeframes: ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"],
  deterministic: true,
  futureDataAllowed: false,
  computePolicy: "Use only feature/context records at or before effectiveAt; reject non-finite numeric inputs.",
}));

export function registeredFeatureIds() {
  return new Set(featureDefinitions.map((definition) => definition.featureId));
}
