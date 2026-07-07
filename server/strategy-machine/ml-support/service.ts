import { createHash } from "crypto";
import { createEvent, type EventReference } from "../core";
import { MlSupportEventTypes } from "./events";
import type { ExperimentPriority, PatternClusterResult, RegimeClassification, TradeQualityRank } from "./contracts";
import { MlSupportRepository } from "./repository";

export class MlSupportService {
  constructor(private readonly repository = new MlSupportRepository()) {}

  classifyRegime(input: { instrument: string; atr: number; trendSlope: number; sourceEventRefs: EventReference[] }) {
    const regime: RegimeClassification["regime"] = input.atr < 0.0005 ? "compressed" : input.atr > 0.003 ? "expanding" : Math.abs(input.trendSlope) > 0.001 ? "trending" : "mean_reverting";
    const result: RegimeClassification = { instrument: input.instrument, regime, confidence: 0.72, sourceEventRefs: input.sourceEventRefs };
    this.repository.save(result as unknown as Record<string, unknown>);
    return createEvent({ type: MlSupportEventTypes.RegimeClassified, module: "ml-support", payload: result as unknown as Record<string, unknown>, sourceEventRefs: input.sourceEventRefs });
  }

  clusterPatterns(input: { patternTypes: string[]; sourceEventRefs: EventReference[] }) {
    const result: PatternClusterResult = { clusterId: createHash("sha1").update(input.patternTypes.sort().join("|")).digest("hex").slice(0, 12), patternTypes: input.patternTypes, distanceScore: Number((1 / Math.max(input.patternTypes.length, 1)).toFixed(6)), sourceEventRefs: input.sourceEventRefs };
    return createEvent({ type: MlSupportEventTypes.PatternClustered, module: "ml-support", payload: result as unknown as Record<string, unknown>, sourceEventRefs: input.sourceEventRefs });
  }

  rankTradeQuality(input: { tradeId: string; rMultiple: number; followedRules: boolean; sourceEventRefs: EventReference[] }) {
    const score = Math.max(0, Math.min(1, (input.rMultiple + 1) / 3 + (input.followedRules ? 0.3 : -0.2)));
    const result: TradeQualityRank = { tradeId: input.tradeId, quality: score > 0.75 ? "high" : score > 0.45 ? "medium" : "low", score: Number(score.toFixed(6)), reasons: ["r_multiple", input.followedRules ? "rules_followed" : "rules_deviation"], sourceEventRefs: input.sourceEventRefs };
    return createEvent({ type: MlSupportEventTypes.TradeQualityRanked, module: "ml-support", payload: result as unknown as Record<string, unknown>, sourceEventRefs: input.sourceEventRefs });
  }

  prioritizeExperiment(input: { experimentId: string; evidenceScore: number; journalQuality: number; sourceEventRefs: EventReference[] }) {
    const score = Number((input.evidenceScore * 0.7 + input.journalQuality * 0.3).toFixed(6));
    const result: ExperimentPriority = { experimentId: input.experimentId, priority: score > 0.75 ? "high" : score > 0.5 ? "normal" : "low", score, sourceEventRefs: input.sourceEventRefs };
    return createEvent({ type: MlSupportEventTypes.ExperimentPriorityUpdated, module: "ml-support", payload: result as unknown as Record<string, unknown>, sourceEventRefs: input.sourceEventRefs });
  }
}

export const mlSupportService = new MlSupportService();
