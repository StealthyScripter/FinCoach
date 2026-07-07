import type { EventReference } from "../core";

export type StrategyStatus = "experimental" | "candidate" | "focus" | "forward_test" | "stable" | "declining" | "paused" | "retired";

export type StrategyEvidence = {
  experimentId: string;
  sampleSize: number;
  expectancy: number;
  maxDrawdown: number;
  forwardTestScore: number;
  journalQuality: number;
  regimeSurvival: number;
  symbolSuitability: number;
  sourceEventRefs: EventReference[];
};

export type StrategyRank = {
  experimentId: string;
  status: StrategyStatus;
  previousStatus: StrategyStatus | null;
  score: number;
  reasons: string[];
  rankedAt: string;
  sourceEventRefs: EventReference[];
};
