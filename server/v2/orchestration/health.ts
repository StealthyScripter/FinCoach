import type { OrchestrationConfig, OrchestrationHealth } from "./contracts";
import type { InMemoryOrchestrationRepository } from "./repository";

export function orchestrationHealth(repository: InMemoryOrchestrationRepository, config: OrchestrationConfig, checkedAt = new Date().toISOString()): OrchestrationHealth {
  const stats = repository.stats(Date.now());
  return {
    module: "orchestration",
    status: config.killSwitchActive ? "degraded" : "healthy",
    schemaVersion: "fincoach.v2.orchestration.1",
    checkedAt,
    ...stats,
    queueDepth: 0,
    liveExecutionBlocked: true,
  };
}
