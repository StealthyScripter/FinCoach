import type { StrategyLifecycleDecision } from "./contracts";

export class InMemoryStrategyLifecycleRepository {
  private readonly decisions = new Map<string, StrategyLifecycleDecision>();

  constructor(seed: readonly StrategyLifecycleDecision[] = []) {
    for (const decision of seed) this.decisions.set(decision.decisionId, freezeRecord(decision));
  }

  save(decision: StrategyLifecycleDecision) {
    const existing = this.decisions.get(decision.decisionId);
    if (existing) return { inserted: false, decision: existing };
    const frozen = freezeRecord(decision);
    this.decisions.set(frozen.decisionId, frozen);
    return { inserted: true, decision: frozen };
  }

  history(strategyId: string) {
    return [...this.decisions.values()].filter(decision => decision.strategyId === strategyId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.decisionId.localeCompare(b.decisionId));
  }

  list() {
    return [...this.decisions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.decisionId.localeCompare(b.decisionId));
  }

  snapshot() {
    return this.list();
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
