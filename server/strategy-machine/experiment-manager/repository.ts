import type { Experiment } from "./contracts";

export class ExperimentRepository {
  private readonly experiments = new Map<string, Experiment>();

  save(experiment: Experiment) {
    this.experiments.set(experiment.experimentId, clone(experiment));
    return experiment;
  }

  get(experimentId: string) {
    const experiment = this.experiments.get(experimentId);
    return experiment ? clone(experiment) : null;
  }
}

function clone(experiment: Experiment): Experiment {
  return JSON.parse(JSON.stringify(experiment)) as Experiment;
}
