import { randomUUID } from "crypto";
import { createEvent, type EventReference } from "../core";
import { ExperimentManagerEventTypes } from "./events";
import type { Experiment, ExperimentState } from "./contracts";
import { ExperimentRepository } from "./repository";

const allowedTransitions: Record<ExperimentState, ExperimentState[]> = {
  draft: ["collecting_data", "paused", "retired"],
  collecting_data: ["backtesting", "paused", "retired"],
  backtesting: ["improving", "ready_for_forward_test", "watch", "retired"],
  improving: ["backtesting", "paused", "retired"],
  ready_for_forward_test: ["forward_testing", "watch", "paused", "retired"],
  forward_testing: ["focus", "watch", "paused", "retired"],
  focus: ["watch", "paused", "retired"],
  watch: ["focus", "paused", "retired"],
  paused: ["collecting_data", "backtesting", "forward_testing", "retired"],
  retired: [],
};

export class ExperimentManagerService {
  constructor(private readonly repository = new ExperimentRepository()) {}

  create(input: { name: string; refs: Partial<Pick<Experiment, "observationRefs" | "patternRefs" | "hypothesisRefs" | "ruleSetRefs">>; now?: Date }) {
    const now = (input.now ?? new Date()).toISOString();
    const experiment: Experiment = {
      experimentId: randomUUID(),
      name: input.name,
      state: "draft",
      createdAt: now,
      updatedAt: now,
      observationRefs: input.refs.observationRefs ?? [],
      patternRefs: input.refs.patternRefs ?? [],
      hypothesisRefs: input.refs.hypothesisRefs ?? [],
      ruleSetRefs: input.refs.ruleSetRefs ?? [],
      backtestRefs: [],
      validationRefs: [],
      forwardTestRefs: [],
      journalRefs: [],
      strategyDecisionRefs: [],
    };
    this.repository.save(experiment);
    return createEvent({ type: ExperimentManagerEventTypes.ExperimentCreated, module: "experiment-manager", payload: experiment as unknown as Record<string, unknown>, sourceEventRefs: allRefs(experiment) });
  }

  transition(experimentId: string, nextState: ExperimentState, refs: EventReference[] = [], now = new Date()) {
    const experiment = this.require(experimentId);
    if (!allowedTransitions[experiment.state].includes(nextState)) throw new Error(`Invalid experiment transition: ${experiment.state} -> ${nextState}`);
    const previousState = experiment.state;
    experiment.state = nextState;
    experiment.updatedAt = now.toISOString();
    attachRefs(experiment, refs);
    this.repository.save(experiment);
    const type = nextState === "focus" ? ExperimentManagerEventTypes.ExperimentPromoted : nextState === "watch" ? ExperimentManagerEventTypes.ExperimentDemoted : nextState === "paused" ? ExperimentManagerEventTypes.ExperimentPaused : nextState === "retired" ? ExperimentManagerEventTypes.ExperimentRetired : ExperimentManagerEventTypes.ExperimentStateChanged;
    return createEvent({ type, module: "experiment-manager", payload: { experiment, previousState, nextState }, sourceEventRefs: refs });
  }

  get(experimentId: string) {
    return this.require(experimentId);
  }

  private require(experimentId: string) {
    const experiment = this.repository.get(experimentId);
    if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);
    return experiment;
  }
}

function attachRefs(experiment: Experiment, refs: EventReference[]) {
  experiment.strategyDecisionRefs.push(...refs);
}

function allRefs(experiment: Experiment) {
  return [
    ...experiment.observationRefs,
    ...experiment.patternRefs,
    ...experiment.hypothesisRefs,
    ...experiment.ruleSetRefs,
    ...experiment.backtestRefs,
    ...experiment.validationRefs,
    ...experiment.forwardTestRefs,
    ...experiment.journalRefs,
    ...experiment.strategyDecisionRefs,
  ];
}

export const experimentManagerService = new ExperimentManagerService();
