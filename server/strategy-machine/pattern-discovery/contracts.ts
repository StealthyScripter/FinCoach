import type { Candle } from "../market-data";
import type { EventReference } from "../core";

export type PatternType =
  | "volatility_compression"
  | "volatility_expansion"
  | "breakout"
  | "pullback"
  | "trend_continuation"
  | "liquidity_sweep"
  | "support_resistance_reaction"
  | "market_structure_shift"
  | "session_breakout"
  | "false_breakout";

export type PatternDetectionInput = {
  instrument: string;
  timeframe: Candle["timeframe"];
  candles: Candle[];
  sourceEventRefs: EventReference[];
};

export type PatternEvidence = {
  windowStart: string;
  windowEnd: string;
  measurements: Record<string, number | string | boolean>;
};

export type DetectedPattern = {
  patternType: PatternType;
  instrument: string;
  timeframe: Candle["timeframe"];
  evidence: PatternEvidence;
  confidence: number;
  invalidationEvidence: string[];
  sourceEventRefs: EventReference[];
};

export type PatternCluster = {
  instrument: string;
  timeframe: Candle["timeframe"];
  patternTypes: PatternType[];
  count: number;
  sourceEventRefs: EventReference[];
};
