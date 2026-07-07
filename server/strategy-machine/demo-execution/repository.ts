import type { DemoExecutionDecision } from "./contracts";

export class DemoExecutionRepository {
  private readonly decisions: DemoExecutionDecision[] = [];

  save(decision: DemoExecutionDecision) {
    this.decisions.push({ ...decision });
    return decision;
  }
}
