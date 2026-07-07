import { createEvent } from "../core";
import { StrategyRankingEventTypes } from "./events";
import type { StrategyEvidence, StrategyRank, StrategyStatus } from "./contracts";
import { StrategyRankingRepository } from "./repository";

export class StrategyRankingService {
  constructor(private readonly repository = new StrategyRankingRepository()) {}

  rank(evidence: StrategyEvidence, previousStatus: StrategyStatus | null = this.repository.latest(evidence.experimentId)?.status ?? null, now = new Date()) {
    const score = round(
      evidence.sampleSize / 100 * 0.15
      + Math.max(evidence.expectancy, 0) * 0.25
      + Math.max(0, 1 - evidence.maxDrawdown) * 0.15
      + evidence.forwardTestScore * 0.2
      + evidence.journalQuality * 0.1
      + evidence.regimeSurvival * 0.1
      + evidence.symbolSuitability * 0.05,
    );
    const status = statusFor(score, evidence, previousStatus);
    const rank: StrategyRank = {
      experimentId: evidence.experimentId,
      status,
      previousStatus,
      score,
      reasons: reasonsFor(evidence, score),
      rankedAt: now.toISOString(),
      sourceEventRefs: evidence.sourceEventRefs,
    };
    this.repository.save(rank);
    return createEvent({ type: eventTypeFor(status, previousStatus), module: "strategy-ranking", payload: rank as unknown as Record<string, unknown>, sourceEventRefs: evidence.sourceEventRefs });
  }
}

function statusFor(score: number, evidence: StrategyEvidence, previous: StrategyStatus | null): StrategyStatus {
  if (previous === "retired") return "retired";
  if (evidence.sampleSize < 30) return "experimental";
  if (evidence.expectancy < 0 || evidence.maxDrawdown > 3) return "retired";
  if (score >= 0.85) return "stable";
  if (score >= 0.72) return "focus";
  if (score >= 0.6) return "candidate";
  if (score >= 0.45) return "declining";
  return "retired";
}

function eventTypeFor(status: StrategyStatus, previous: StrategyStatus | null) {
  if (status === "retired") return StrategyRankingEventTypes.StrategyRetired;
  if (status === "paused") return StrategyRankingEventTypes.StrategyPaused;
  if (previous && rankWeight(status) < rankWeight(previous)) return StrategyRankingEventTypes.StrategyDemoted;
  if (previous && rankWeight(status) > rankWeight(previous)) return StrategyRankingEventTypes.StrategyPromoted;
  return StrategyRankingEventTypes.StrategyRanked;
}

function rankWeight(status: StrategyStatus) {
  return ["retired", "paused", "declining", "experimental", "candidate", "forward_test", "focus", "stable"].indexOf(status);
}

function reasonsFor(evidence: StrategyEvidence, score: number) {
  return [
    `evidence_score=${score}`,
    `sample_size=${evidence.sampleSize}`,
    `expectancy=${evidence.expectancy}`,
    `max_drawdown=${evidence.maxDrawdown}`,
    `journal_quality=${evidence.journalQuality}`,
  ];
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const strategyRankingService = new StrategyRankingService();
