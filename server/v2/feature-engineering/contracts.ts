import { z } from "zod";
import { type TechnicalFeatureSet } from "../chart-analysis";
import { type MarketContext } from "../market-context";

export type FeatureDefinition = {
  featureId: string;
  version: string;
  description: string;
  inputs: string[];
  warmupPeriods: number;
  supportedTimeframes: string[];
  deterministic: true;
  futureDataAllowed: false;
  computePolicy: string;
};

export type EngineeredFeature = {
  featureId: string;
  version: string;
  value: number | string | boolean | null;
  qualityScore: number;
  missingDataState: "complete" | "partial" | "insufficient" | "stale";
};

export type FeatureVector = {
  vectorId: string;
  schemaVersion: "fincoach.v2.features.1";
  symbol: string;
  timeframe: string;
  inputEventIds: string[];
  inputRange: { start: string; end: string };
  computedAt: string;
  effectiveAt: string;
  correlationId: string;
  causationId: string | null;
  features: EngineeredFeature[];
};

export const featureEngineeringInputSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  effectiveAt: z.string().datetime(),
  chartFeatureHistory: z.array(z.custom<TechnicalFeatureSet>()).min(1),
  contextHistory: z.array(z.custom<MarketContext>()).default([]),
  inputEventIds: z.array(z.string().uuid()).min(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable().default(null),
});

export type FeatureEngineeringInput = z.infer<typeof featureEngineeringInputSchema>;

export type FeatureEngineeringRepository = {
  save(vector: FeatureVector): Promise<{ inserted: boolean; existing?: FeatureVector }>;
  findById(vectorId: string): Promise<FeatureVector | null>;
};
