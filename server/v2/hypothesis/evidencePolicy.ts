import type { HypothesisGenerationInput } from "./contracts";

export function validateHypothesisInput(input: HypothesisGenerationInput) {
  if (!input.baseline) throw new Error("missing baseline");
  if (!input.expectedOutcome) throw new Error("missing measurable outcome");
  if (!input.invalidationCriteria.length) throw new Error("missing invalidation criteria");
  if (input.conditions.some((condition) => condition.usesFutureData)) throw new Error("future-dependent condition rejected");
  if (input.conditions.some((condition) => condition.field === input.expectedOutcome.metric)) throw new Error("circular definition rejected");
  if (input.conditions.length > 8) throw new Error("excessive hypothesis complexity");
  if (input.sourceObservationIds.length < input.minimumIndependentOccurrences || input.evidenceEventIds.length < input.minimumIndependentOccurrences) throw new Error("insufficient evidence");
  if (!input.evidenceEventIds.length || !input.sourceTraderAnalysisIds.length) throw new Error("incomplete lineage");
}
export function dataMiningRisk(conditionCount: number): "low" | "medium" | "high" {
  return conditionCount <= 3 ? "low" : conditionCount <= 6 ? "medium" : "high";
}
