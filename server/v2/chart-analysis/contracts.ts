import { z } from "zod";
import { normalizedCandleSchema } from "../market-data";

export const chartAnalysisInputSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  candles: z.array(normalizedCandleSchema).min(5),
  featureDefinitionVersion: z.string().min(1).default("chart-analysis.v1"),
});
export type ChartAnalysisInput = z.infer<typeof chartAnalysisInputSchema>;

export type SwingPoint = {
  index: number;
  timestamp: string;
  kind: "high" | "low";
  price: number;
};

export type TechnicalFeatureSet = {
  featureSetId: string;
  symbol: string;
  timeframe: string;
  computedAt: string;
  featureDefinitionVersion: string;
  structure: {
    swings: SwingPoint[];
    trend: "uptrend" | "downtrend" | "range" | "unknown";
    breakOfStructure: boolean;
    changeOfCharacter: boolean;
    consolidation: boolean;
    support: number | null;
    resistance: number | null;
  };
  volatility: {
    atr: number;
    realizedVolatility: number;
    compression: boolean;
    expansion: boolean;
    gap: boolean;
    rangePercentile: number;
    shock: boolean;
  };
  momentum: {
    rsi: number | null;
    macd: number | null;
    adx: number | null;
    rateOfChange: number;
    acceleration: number;
    divergence: "bullish" | "bearish" | "none";
  };
  participation: {
    volume: number | null;
    relativeVolume: number | null;
    vwap: number | null;
    distanceFromVwap: number | null;
  };
  liquidity: {
    equalHighs: boolean;
    equalLows: boolean;
    sweep: boolean;
    falseBreakout: boolean;
    wickRejection: boolean;
    failedAuction: boolean;
    stopRunProxy: boolean;
    fairValueGapCandidate: boolean;
    imbalanceCandidate: boolean;
  };
};
