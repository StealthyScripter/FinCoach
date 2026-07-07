import type { EventReference } from "../core";

export type ValidationVerdict = "reject" | "needs_more_data" | "watch" | "candidate" | "ready_for_forward_test";

export type ValidationResult = {
  experimentId: string;
  verdict: ValidationVerdict;
  evidenceScore: number;
  minimumSampleThreshold: number;
  actualSampleSize: number;
  walkForwardScore: number;
  outOfSampleScore: number;
  monteCarloRobustness: number;
  parameterStability: number;
  regimeStability: number;
  symbolStability: number;
  overfittingWarning: boolean;
  sourceBacktestRefs: EventReference[];
};
