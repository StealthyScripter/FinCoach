import type { EventReference } from "../core";
import type { PatternType } from "../pattern-discovery";

export type HypothesisStatus = "created" | "rejected" | "needs_more_data";

export type Hypothesis = {
  hypothesisId: string;
  statement: string;
  instrument: string;
  timeframe: string;
  patternTypes: PatternType[];
  supportedMarkets: Array<"forex" | "metal" | "stock">;
  regimeTags: string[];
  score: number;
  requiredSampleSize: number;
  status: HypothesisStatus;
  rejectionReason: string | null;
  sourcePatternRefs: EventReference[];
};
