import type { OrchestrationCheckpoint } from "./contracts";

export function createCheckpoint(input: OrchestrationCheckpoint): OrchestrationCheckpoint {
  return { ...input };
}
