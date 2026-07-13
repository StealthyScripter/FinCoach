import type { StrategyRankingDecision } from "./contracts";

export class InMemoryRankingRepository {
  private readonly rankings = new Map<string, StrategyRankingDecision>();
  save(decision: StrategyRankingDecision) {
    if (!this.rankings.has(decision.rankingId)) this.rankings.set(decision.rankingId, decision);
    return this.rankings.get(decision.rankingId)!;
  }
  get(id: string) { return this.rankings.get(id) ?? null; }
  list() { return [...this.rankings.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt) || a.rankingId.localeCompare(b.rankingId)); }
}
