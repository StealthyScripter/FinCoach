import { createHash } from "crypto";
import type { ExperimentInput } from "./contracts";
export function experimentFingerprint(input: ExperimentInput) {
  return createHash("sha256").update(JSON.stringify({ hypothesisId: input.hypothesisId, strategyId: input.strategyId, strategyVersion: input.strategyVersion, experimentType: input.experimentType, dataset: input.datasetSpecification, parameters: input.parameterSpecification, holdout: input.holdoutPolicy, seed: input.randomSeed })).digest("hex");
}
