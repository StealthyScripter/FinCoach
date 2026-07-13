import type { RankingCandidateInput, RankedStrategy } from "./contracts";

export const RANKING_POLICY_VERSION = "fincoach.v2.ranking.policy.1";
export function assertFiniteMetrics(candidate: RankingCandidateInput) {
  for (const [key, value] of Object.entries(candidate.metrics)) if (!Number.isFinite(value)) throw new Error(`invalid metric ${key}`);
  if (!Number.isFinite(candidate.similarityConfidence) || !Number.isFinite(candidate.evidenceFreshness)) throw new Error("invalid evidence metric");
}
export function scoreCandidate(candidate: RankingCandidateInput): RankedStrategy {
  assertFiniteMetrics(candidate);
  const reasons: string[] = [];
  if (!candidate.lineageEventIds.length) return { ...candidate, score: -Infinity, rank: 0, status: "require_more_evidence", reasons: ["missing_lineage"] };
  if (candidate.courtVerdict === "reject") return { ...candidate, score: -Infinity, rank: 0, status: "retire_research", reasons: ["court_rejected"] };
  const m = candidate.metrics;
  const score = (m.oosExpectancy * 4) + (m.walkForwardStability * 2) + (m.parameterRobustness * 1.5) + (m.costResilience * 2) + m.regimeDiversity + (candidate.evidenceFreshness * 0.8) + (candidate.similarityConfidence * 0.4)
    - (m.maxDrawdown * 2.5) - (m.tailRisk * 1.5) - (m.operationalComplexity * 0.8) - (m.turnover * 0.4);
  if (m.maxDrawdown > 0.35) reasons.push("drawdown_penalty");
  if (m.costResilience < 0.4) reasons.push("cost_fragile");
  if (candidate.evidenceFreshness < 0.5) reasons.push("stale_evidence");
  return { ...candidate, score: Number(score.toFixed(6)), rank: 0, status: "candidate", reasons };
}
