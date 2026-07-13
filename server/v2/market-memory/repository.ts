import type { MarketStateVector } from "./contracts";

export class InMemoryMarketMemoryRepository {
  private readonly vectors = new Map<string, MarketStateVector>();
  save(vector: MarketStateVector) {
    if (!this.vectors.has(vector.stateId)) this.vectors.set(vector.stateId, vector);
    return this.vectors.get(vector.stateId)!;
  }
  get(id: string) { return this.vectors.get(id) ?? null; }
  list() { return [...this.vectors.values()].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.stateId.localeCompare(b.stateId)); }
}
