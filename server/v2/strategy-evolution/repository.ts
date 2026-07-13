import type { EvolvedStrategyRevisionProposal } from "./contracts";

export class InMemoryStrategyEvolutionRepository {
  private readonly proposals = new Map<string, EvolvedStrategyRevisionProposal>();

  constructor(seed: readonly EvolvedStrategyRevisionProposal[] = []) {
    for (const proposal of seed) this.proposals.set(proposal.proposalId, freezeRecord(proposal));
  }

  save(proposal: EvolvedStrategyRevisionProposal) {
    const existing = this.proposals.get(proposal.proposalId);
    if (existing) return { inserted: false, proposal: existing };
    const frozen = freezeRecord(proposal);
    this.proposals.set(frozen.proposalId, frozen);
    return { inserted: true, proposal: frozen };
  }

  list() {
    return [...this.proposals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.proposalId.localeCompare(b.proposalId));
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
