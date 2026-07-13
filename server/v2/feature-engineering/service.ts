import { createHash, randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { TechnicalFeatureSet } from "../chart-analysis";
import type { MarketContext } from "../market-context";
import { featureEngineeringInputSchema, type EngineeredFeature, type FeatureEngineeringInput, type FeatureVector } from "./contracts";
import { FeatureEngineeringV2EventTypes } from "./events";
import { featureDefinitions, registeredFeatureIds } from "./featureRegistry";
import { InMemoryFeatureEngineeringRepository } from "./repository";

export class FeatureEngineeringV2Service {
  constructor(private readonly repository = new InMemoryFeatureEngineeringRepository()) {}

  registry() {
    return featureDefinitions.map((definition) => ({ ...definition, inputs: [...definition.inputs], supportedTimeframes: [...definition.supportedTimeframes] }));
  }

  async compute(input: FeatureEngineeringInput): Promise<{ vector: FeatureVector; events: DomainEvent[] }> {
    const parsed = featureEngineeringInputSchema.parse(input);
    const effective = Date.parse(parsed.effectiveAt);
    const charts = parsed.chartFeatureHistory.filter((item) => Date.parse(item.computedAt) <= effective);
    const contexts = parsed.contextHistory.filter((item) => Date.parse(item.observedAt) <= effective);
    if (charts.length !== parsed.chartFeatureHistory.length || contexts.length !== parsed.contextHistory.length) {
      throw new Error("Feature engineering rejected future input data");
    }
    if (charts.length < 1) throw new Error("Feature engineering requires chart features");
    const latest = charts[charts.length - 1];
    const vector: FeatureVector = {
      vectorId: stableVectorId(parsed),
      schemaVersion: "fincoach.v2.features.1",
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      inputEventIds: [...parsed.inputEventIds],
      inputRange: { start: charts[0].computedAt, end: latest.computedAt },
      computedAt: parsed.effectiveAt,
      effectiveAt: parsed.effectiveAt,
      correlationId: parsed.correlationId,
      causationId: parsed.causationId,
      features: computeFeatures(charts, contexts),
    };
    const ids = registeredFeatureIds();
    if (!vector.features.every((feature) => ids.has(feature.featureId))) throw new Error("Feature vector contains unregistered feature");
    await this.repository.save(vector);
    const event = createDomainEvent({
      eventType: FeatureEngineeringV2EventTypes.FeatureVectorComputed,
      sourceModule: "chart-analysis",
      correlationId: parsed.correlationId,
      causationId: parsed.causationId,
      payload: { vectorId: vector.vectorId, symbol: vector.symbol, timeframe: vector.timeframe, featureCount: vector.features.length },
      metadata: { inputEventIds: vector.inputEventIds },
      occurredAt: new Date(parsed.effectiveAt),
    });
    return { vector, events: [event] };
  }
}

function computeFeatures(charts: TechnicalFeatureSet[], contexts: MarketContext[]): EngineeredFeature[] {
  const latest = charts[charts.length - 1];
  const context = contexts.at(-1) ?? null;
  const rsiSeries = charts.map((item) => item.momentum.rsi).filter(finite);
  const atrSeries = charts.map((item) => item.volatility.atr).filter(finite);
  const rangeSeries = charts.map((item) => item.volatility.rangePercentile).filter(finite);
  const rocSeries = charts.map((item) => item.momentum.rateOfChange).filter(finite);
  return [
    feature("rsi_percentile", percentile(rsiSeries, latest.momentum.rsi), rsiSeries.length >= 5),
    feature("atr_zscore", zscore(atrSeries, latest.volatility.atr), atrSeries.length >= 5),
    feature("atr_robust_zscore", robustZscore(atrSeries, latest.volatility.atr), atrSeries.length >= 5),
    feature("momentum_acceleration", latest.momentum.acceleration, true),
    feature("volume_relative_session", latest.participation.relativeVolume, Boolean(context)),
    feature("range_regime_percentile", percentile(rangeSeries, latest.volatility.rangePercentile), rangeSeries.length >= 3),
    feature("vwap_distance_atr", latest.participation.distanceFromVwap === null || latest.volatility.atr === 0 ? null : latest.participation.distanceFromVwap / latest.volatility.atr, latest.participation.distanceFromVwap !== null),
    feature("timeframe_alignment_score", alignment(latest, context), Boolean(context)),
    feature("abnormal_return_score", zscore(rocSeries, latest.momentum.rateOfChange), rocSeries.length >= 5),
    feature("liquidity_stress_score", liquidityStress(latest, context), Boolean(context)),
  ];
}

function feature(featureId: string, value: number | string | boolean | null, complete: boolean): EngineeredFeature {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Feature ${featureId} produced non-finite value`);
  return { featureId, version: "feature-engineering.v1", value, qualityScore: complete && value !== null ? 1 : 0.4, missingDataState: complete && value !== null ? "complete" : "insufficient" };
}

function percentile(values: number[], target: number | null) {
  if (target === null || values.length === 0) return null;
  return round(values.filter((value) => value <= target).length / values.length);
}

function zscore(values: number[], target: number | null) {
  if (target === null || values.length < 2) return null;
  const avg = mean(values);
  const sd = Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
  return sd === 0 ? 0 : round((target - avg) / sd);
}

function robustZscore(values: number[], target: number | null) {
  if (target === null || values.length < 2) return null;
  const med = median(values);
  const mad = median(values.map((value) => Math.abs(value - med)));
  return mad === 0 ? 0 : round((target - med) / (1.4826 * mad));
}

function alignment(latest: TechnicalFeatureSet, context: MarketContext | null) {
  if (!context || latest.structure.trend === "unknown" || context.higherTimeframeDirection === "unknown") return 0;
  if ((latest.structure.trend === "uptrend" && context.higherTimeframeDirection === "up") || (latest.structure.trend === "downtrend" && context.higherTimeframeDirection === "down")) return 1;
  return -1;
}

function liquidityStress(latest: TechnicalFeatureSet, context: MarketContext | null) {
  if (!context) return null;
  return round((latest.liquidity.sweep ? 0.4 : 0) + (context.spreadState === "wide" ? 0.3 : 0) + (context.liquidityState === "thin" || context.liquidityState === "closed" ? 0.3 : 0));
}

function stableVectorId(input: FeatureEngineeringInput) {
  return createHash("sha256").update(JSON.stringify({ symbol: input.symbol, timeframe: input.timeframe, effectiveAt: input.effectiveAt, inputEventIds: input.inputEventIds })).digest("hex").slice(0, 32);
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function round(value: number) { return Number(value.toFixed(6)); }

export const featureEngineeringV2Service = new FeatureEngineeringV2Service();
