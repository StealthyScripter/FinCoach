import type { EventReference } from "../core";

export const experimentStates = ["draft", "collecting_data", "backtesting", "improving", "ready_for_forward_test", "forward_testing", "focus", "watch", "paused", "retired"] as const;
export type ExperimentState = typeof experimentStates[number];

export type Experiment = {
  experimentId: string;
  name: string;
  state: ExperimentState;
  createdAt: string;
  updatedAt: string;
  observationRefs: EventReference[];
  patternRefs: EventReference[];
  hypothesisRefs: EventReference[];
  ruleSetRefs: EventReference[];
  backtestRefs: EventReference[];
  validationRefs: EventReference[];
  forwardTestRefs: EventReference[];
  journalRefs: EventReference[];
  strategyDecisionRefs: EventReference[];
};
