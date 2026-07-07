import type { Hypothesis } from "./contracts";

export class HypothesisRepository {
  private readonly hypotheses = new Map<string, Hypothesis>();

  save(hypothesis: Hypothesis) {
    this.hypotheses.set(hypothesis.hypothesisId, { ...hypothesis, sourcePatternRefs: [...hypothesis.sourcePatternRefs] });
    return hypothesis;
  }

  list() {
    return Array.from(this.hypotheses.values()).map((hypothesis) => ({ ...hypothesis, sourcePatternRefs: [...hypothesis.sourcePatternRefs] }));
  }
}
