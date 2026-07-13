import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { RankingRequest, StrategyRankingDecision } from "./contracts";
import { RankingV2EventTypes } from "./events";
import { InMemoryRankingRepository } from "./repository";
import { RANKING_POLICY_VERSION, scoreCandidate } from "./scorecard";
import { selectFocusedPortfolio } from "./selector";

export class RankingV2Service {
  constructor(private readonly repository = new InMemoryRankingRepository()) {}
  rank(input: RankingRequest): { decision: StrategyRankingDecision; events: DomainEvent[] } {
    try {
      const ranked = input.candidates.map(scoreCandidate).sort((a, b) => b.score - a.score || a.strategyId.localeCompare(b.strategyId)).map((c, i) => ({ ...c, rank: i + 1 }));
      const focusedPortfolio = selectFocusedPortfolio(ranked, input.maxFocusedCount);
      const decision: StrategyRankingDecision = {
        rankingId: createHash("sha256").update(JSON.stringify({ policy: RANKING_POLICY_VERSION, candidates: ranked.map((c) => [c.strategyId, c.strategyVersion, c.score, c.status]), max: input.maxFocusedCount })).digest("hex").slice(0, 32),
        policyVersion: RANKING_POLICY_VERSION, generatedAt: input.generatedAt ?? new Date().toISOString(), candidates: ranked, focusedPortfolio,
        demotions: ranked.filter((c) => c.reasons.includes("stale_evidence") || c.reasons.includes("cost_fragile")).map((c) => ({ strategyId: c.strategyId, status: "demote", reason: c.reasons.join(",") })),
        retirements: ranked.filter((c) => c.status === "retire_research").map((c) => ({ strategyId: c.strategyId, status: "retire_research", reason: "court_rejected" })),
        evidenceGaps: ranked.filter((c) => c.status === "require_more_evidence").map((c) => ({ strategyId: c.strategyId, status: "require_more_evidence", reason: "missing_lineage" })),
        correlationMatrixReference: createHash("sha256").update(JSON.stringify(ranked.map((c) => [c.strategyId, c.correlationCluster]).sort())).digest("hex").slice(0, 16),
        correlationId: input.correlationId, causationId: input.causationId,
      };
      this.repository.save(decision);
      const events = [createDomainEvent({ eventType: RankingV2EventTypes.StrategyRankingComputed, sourceModule: "ranking", correlationId: input.correlationId, causationId: input.causationId, payload: { rankingId: decision.rankingId } }),
        createDomainEvent({ eventType: RankingV2EventTypes.ResearchPortfolioSelected, sourceModule: "ranking", correlationId: input.correlationId, causationId: input.causationId, payload: { rankingId: decision.rankingId, focused: focusedPortfolio.strategies.length } })];
      return { decision, events };
    } catch (error) {
      throw new Error(`ranking failed closed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  get(id: string) { return this.repository.get(id); }
  list() { return this.repository.list(); }
}
export const rankingV2Service = new RankingV2Service();
