import type { StrategyRank } from "./contracts";

export class StrategyRankingRepository {
  private readonly ranks = new Map<string, StrategyRank[]>();

  save(rank: StrategyRank) {
    const history = this.ranks.get(rank.experimentId) ?? [];
    history.push(JSON.parse(JSON.stringify(rank)) as StrategyRank);
    this.ranks.set(rank.experimentId, history);
    return rank;
  }

  latest(experimentId: string) {
    const history = this.ranks.get(experimentId) ?? [];
    return history.length ? JSON.parse(JSON.stringify(history[history.length - 1])) as StrategyRank : null;
  }
}
