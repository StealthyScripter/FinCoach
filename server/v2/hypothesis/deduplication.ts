import { createHash } from "crypto";
import type { HypothesisGenerationInput, ObjectiveCondition } from "./contracts";

export function hypothesisFingerprint(input: Pick<HypothesisGenerationInput, "conditions" | "expectedOutcome" | "baseline" | "targetPopulation">) {
  return createHash("sha256").update(JSON.stringify({
    conditions: canonicalConditions(input.conditions),
    outcome: input.expectedOutcome,
    baseline: input.baseline.baselineId,
    population: input.targetPopulation,
  })).digest("hex");
}
export function canonicalConditions(conditions: ObjectiveCondition[]) {
  return [...conditions].sort((a, b) => `${a.field}:${a.operator}:${JSON.stringify(a.value)}`.localeCompare(`${b.field}:${b.operator}:${JSON.stringify(b.value)}`));
}
