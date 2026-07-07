import type { EventReference } from "../core";

export type RegimeClassification = {
  instrument: string;
  regime: "compressed" | "expanding" | "trending" | "mean_reverting" | "unstable";
  confidence: number;
  sourceEventRefs: EventReference[];
};

export type PatternClusterResult = {
  clusterId: string;
  patternTypes: string[];
  distanceScore: number;
  sourceEventRefs: EventReference[];
};

export type TradeQualityRank = {
  tradeId: string;
  quality: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  sourceEventRefs: EventReference[];
};

export type ExperimentPriority = {
  experimentId: string;
  priority: "low" | "normal" | "high";
  score: number;
  sourceEventRefs: EventReference[];
};
