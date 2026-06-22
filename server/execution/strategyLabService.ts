import { randomUUID } from "crypto";
import type { PredictionReview, JournalReview } from "@shared/schema";
import type { ClosedPaperTrade } from "./paperStrategyRuntime";
import type { PostTradeReview } from "./postTradeReviewService";
import type { StrategyAdaptationSuggestion } from "./strategyAdaptationService";
import type { StrategyLifecycleReport } from "./strategyLifecycleMonitorService";
import type { StrategyDefinition } from "./domain";
import type { StrategyValidationInput, StrategyValidationScorecard } from "./strategyValidation";
import { sampleDepthService, strategyEvidenceStore, type StrategyEvidenceRecord, type StrategyRejectedSignalAnalysis, type StrategyTradeEvidenceContext } from "./strategyEvidenceStore";

export type MemoryGraphNodeKind =
  | "lesson"
  | "mistake"
  | "strategy"
  | "asset"
  | "outcome"
  | "review"
  | "updated_rule"
  | "reminder"
  | "future_trade";

export type MemoryGraphNode = {
  id: string;
  kind: MemoryGraphNodeKind;
  label: string;
  confidence: number;
  timestamp: string;
  metadata: Record<string, unknown>;
  sourceCount: number;
};

export type MemoryGraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: number;
  influence: number;
  timestamp: string;
};

export type MemoryGraphReport = {
  generatedAt: string;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  traversal: {
    startNodeId: string | null;
    visitedNodeIds: string[];
    pathSummaries: string[];
  };
  influenceScores: Array<{ nodeId: string; score: number }>;
};

export type RecurringMistakeItem = {
  pattern: "overconfidence" | "revenge_trading" | "fomo" | "oversized_positions" | "stop_widening" | "strategy_switching";
  count: number;
  latestEvidence: string;
  interventionRecommendation: string;
  lessonPriority: number;
};

export type RecurringMistakeReport = {
  generatedAt: string;
  items: RecurringMistakeItem[];
  interventionRecommendation: string;
  lessonPriority: number;
};

export type ConfidenceCalibrationItem = {
  predictionId: string;
  confidence: number;
  outcome: string;
  wasOverconfident: boolean;
};

export type ConfidenceCalibrationReport = {
  generatedAt: string;
  totalReviews: number;
  expectedAccuracy: number;
  observedAccuracy: number;
  calibrationDrift: number;
  overconfidenceTendency: number;
  items: ConfidenceCalibrationItem[];
  confidenceAdjustmentSuggestions: string[];
};

export type StrategyEvolutionSymbolRow = {
  symbol: string;
  expectancy: number;
  drawdown: number;
  winRate: number;
  tradeCount: number;
  consistency: number;
  robustness: number;
};

export type StrategyEvolutionReport = {
  strategyId: string;
  strategyName: string;
  strategyType: StrategyDefinition["type"] | "unknown";
  sampleSize: number;
  overallScore: number;
  confidence: number;
  verdict: "healthy" | "watch" | "pause" | "retire";
  parameterStability: {
    robustnessScore: number;
    overfittingRisk: number;
    fragileParameters: string[];
    narrowOptima: string[];
    unstablePerformance: string[];
    recommendations: string[];
  };
  regimePerformance: {
    trending: number;
    ranging: number;
    highVolatility: number;
    lowVolatility: number;
    allowedRegimes: string[];
    recommendations: string[];
  };
  symbolSuitability: StrategyEvolutionSymbolRow[];
  retirement: {
    verdict: "healthy" | "watch" | "pause" | "retire";
    reasons: string[];
  };
  scoreEvolution: {
    overallScore: number;
    confidence: number;
    verdict: "healthy" | "watch" | "pause" | "retire";
    reasons: string[];
    adjustmentNotes: string[];
  };
  evidenceRankingScore: number;
  validationScore: number;
  sampleDepthScore: number;
  regretScore: number;
  calibrationScore: number;
  riskAdjustedReturnScore: number;
  regimeCoverageScore: number;
  symbolCoverageScore: number;
  behavioralPenalty: number;
  evidenceDepth: StrategyEvidenceDepthReport;
  verdictExplanation: StrategyVerdictExplanation;
};

export type StrategyEvidenceDepthReport = {
  strategyId: string;
  verdict: "insufficient" | "developing" | "acceptable" | "robust";
  score: number;
  totalTrades: number;
  recentTrades: number;
  symbolsTested: string[];
  regimesTested: string[];
  timeframesTested: string[];
  winLossDiversity: boolean;
  stressScenarioCoverage: number;
  minimumEvidenceThreshold: boolean;
};

export type StrategyVerdictExplanation = {
  whyRankedThisWay: string[];
  strongestEvidence: string[];
  weakestEvidence: string[];
  missingEvidence: string[];
  confidenceImprovement: string[];
  sampleDepthSufficient: boolean;
};

export type RegretItem = {
  pattern: "missed_trades" | "bad_exits" | "early_exits" | "late_exits" | "skipped_winners" | "unnecessary_losses";
  count: number;
  latestEvidence: string;
  learningNote: string;
  confidenceUpdate: number;
};

export type RegretAnalysisReport = {
  generatedAt: string;
  items: RegretItem[];
  regretScore: number;
  learningNotes: string[];
  confidenceUpdates: string[];
};

export type CounterfactualScenarioResult = {
  scenario: "tighter_stop" | "wider_stop" | "no_trade" | "reduced_size" | "different_target" | "trailing_stop";
  estimatedPnL: number;
  deltaFromActual: number;
  explanation: string;
};

export type CounterfactualTradeReport = {
  tradeId: string;
  strategyId: string;
  symbol: string;
  actualPnL: number;
  scenarios: CounterfactualScenarioResult[];
};

export type CounterfactualAnalysisReport = {
  generatedAt: string;
  tradeCount: number;
  items: CounterfactualTradeReport[];
  summary: string[];
};

export type PerformanceDecayItem = {
  strategyId: string;
  strategyName: string;
  verdict: "healthy" | "monitor" | "pause" | "retire";
  rollingSharpeDeterioration: number;
  drawdownIncrease: number;
  expectancyDrop: number;
  winRateDrop: number;
  volatilityMismatch: number;
  reasons: string[];
};

export type PerformanceDecayReport = {
  generatedAt: string;
  items: PerformanceDecayItem[];
};

export type CrossStrategyComparisonItem = {
  strategyType: string;
  expectancy: number;
  drawdown: number;
  consistency: number;
  robustness: number;
  regretScore: number;
  tradeCount: number;
  rank: number;
};

export type CrossStrategyComparisonReport = {
  generatedAt: string;
  items: CrossStrategyComparisonItem[];
  summary: string[];
};

export type LearningPriorityItem = {
  id: string;
  lessonPriority: number;
  urgency: "low" | "medium" | "high" | "critical";
  title: string;
  explanation: string;
  relatedStrategies: string[];
};

export type LearningPriorityReport = {
  generatedAt: string;
  items: LearningPriorityItem[];
};

export type StrategyLabSnapshot = {
  generatedAt: string;
  topStrategies: StrategyEvolutionReport[];
  weakStrategies: StrategyEvolutionReport[];
  retirementCandidates: StrategyEvolutionReport[];
  adaptationSuggestions: Array<{
    strategyId: string;
    type: StrategyAdaptationSuggestion["type"];
    reason: string;
    status: StrategyAdaptationSuggestion["status"];
  }>;
  latestLessons: Array<{
    source: string;
    lesson: string;
    strategyId: string | null;
    timestamp: string;
  }>;
  memoryGraph: MemoryGraphReport;
  recurringMistakes: RecurringMistakeReport;
  confidenceCalibration: ConfidenceCalibrationReport;
  strategyEvolution: StrategyEvolutionReport[];
  regretAnalysis: RegretAnalysisReport;
  counterfactualAnalysis: CounterfactualAnalysisReport;
  performanceDecay: PerformanceDecayReport;
  crossStrategyComparison: CrossStrategyComparisonReport;
  learningPriorities: LearningPriorityReport;
  evidenceDepth: StrategyEvidenceDepthReport[];
  closedTradeHistory: Array<{
    strategyId: string;
    strategyName: string;
      trades: Array<{
      id: string;
      symbol: string;
      tradeKind: "paper_trade" | "sandbox_trade";
      verdict: string | null;
      outcome: string;
      realizedPnL?: number;
      exitReason?: string;
      openedAt: string;
      closedAt: string;
      regime: string | null;
      timeframe: string | null;
      originalStrategyInputs?: Record<string, unknown> | null;
      signalFeatures?: Record<string, unknown> | null;
      }>;
  }>;
  rejectedSignalLearning: Array<{
    strategyId: string;
    strategyName: string;
    signals: StrategyRejectedSignalAnalysis[];
  }>;
  verdictExplanations: Array<{
    strategyId: string;
    strategyName: string;
    verdict: StrategyEvolutionReport["verdict"];
    overallScore: number;
    sampleDepthSufficient: boolean;
    whyRankedThisWay: string[];
    strongestEvidence: string[];
    weakestEvidence: string[];
    missingEvidence: string[];
    confidenceImprovement: string[];
  }>;
};

type StrategyLabInput = {
  strategies: StrategyDefinition[];
  validationInputs: StrategyValidationInput[];
  scorecards: StrategyValidationScorecard[];
  closedTrades: ClosedPaperTrade[];
  postTradeReviews: PostTradeReview[];
  predictionReviews: PredictionReview[];
  journalReviews?: JournalReview[];
  adaptations: StrategyAdaptationSuggestion[];
  lifecycleReports: StrategyLifecycleReport[];
  evidenceRecords?: StrategyEvidenceRecord[];
  rejectedSignalAnalyses?: StrategyRejectedSignalAnalysis[];
};

type GraphRecord = {
  kind: MemoryGraphNodeKind;
  label: string;
  confidence: number;
  timestamp: string;
  metadata: Record<string, unknown>;
  sourceCount: number;
};

export class MemoryGraphService {
  private readonly nodes = new Map<string, MemoryGraphNode>();
  private readonly edges: MemoryGraphEdge[] = [];

  recordChain(input: {
    lesson: string;
    mistake: string;
    strategyId: string;
    strategyName: string;
    asset: string;
    outcome: string;
    reviewId: string;
    updatedRule: string;
    reminder: string;
    futureTrade: string;
    confidence: number;
    timestamp: string;
  }) {
    const lesson = this.upsertNode(nodeId("lesson", input.lesson), {
      kind: "lesson",
      label: input.lesson,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });
    const mistake = this.upsertNode(nodeId("mistake", input.mistake), {
      kind: "mistake",
      label: input.mistake,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });
    const strategy = this.upsertNode(`strategy-${input.strategyId}`, {
      kind: "strategy",
      label: input.strategyName,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId },
      sourceCount: 1,
    });
    const asset = this.upsertNode(nodeId("asset", input.asset), {
      kind: "asset",
      label: input.asset,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId },
      sourceCount: 1,
    });
    const outcome = this.upsertNode(nodeId("outcome", input.outcome), {
      kind: "outcome",
      label: input.outcome,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });
    const review = this.upsertNode(`review-${input.reviewId}`, {
      kind: "review",
      label: `Review ${input.reviewId}`,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId },
      sourceCount: 1,
    });
    const rule = this.upsertNode(nodeId("updated-rule", input.updatedRule), {
      kind: "updated_rule",
      label: input.updatedRule,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });
    const reminder = this.upsertNode(nodeId("reminder", input.reminder), {
      kind: "reminder",
      label: input.reminder,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });
    const futureTrade = this.upsertNode(nodeId("future-trade", input.futureTrade), {
      kind: "future_trade",
      label: input.futureTrade,
      confidence: input.confidence,
      timestamp: input.timestamp,
      metadata: { strategyId: input.strategyId, reviewId: input.reviewId },
      sourceCount: 1,
    });

    this.link(lesson, mistake, "lesson_to_mistake", 0.92, input.timestamp);
    this.link(mistake, strategy, "mistake_to_strategy", 0.88, input.timestamp);
    this.link(strategy, asset, "strategy_to_asset", 0.84, input.timestamp);
    this.link(strategy, outcome, "strategy_to_outcome", 0.9, input.timestamp);
    this.link(outcome, review, "outcome_to_review", 0.95, input.timestamp);
    this.link(review, rule, "review_to_updated_rule", 0.88, input.timestamp);
    this.link(rule, reminder, "updated_rule_to_reminder", 0.82, input.timestamp);
    this.link(reminder, futureTrade, "reminder_to_future_trade", 0.78, input.timestamp);
  }

  traverse(startNodeId: string | null, limit = 12) {
    if (!startNodeId || !this.nodes.has(startNodeId)) {
      return { startNodeId: null, visitedNodeIds: [], pathSummaries: [] };
    }
    const queue = [startNodeId];
    const visited: string[] = [];
    const seen = new Set<string>();
    while (queue.length && visited.length < limit) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      visited.push(current);
      const outgoing = this.edges
        .filter((edge) => edge.from === current)
        .sort((left, right) => right.influence - left.influence || right.confidence - left.confidence);
      for (const edge of outgoing) queue.push(edge.to);
    }
    return {
      startNodeId,
      visitedNodeIds: visited,
      pathSummaries: visited.map((nodeId) => this.nodes.get(nodeId)?.label ?? nodeId),
    };
  }

  influenceScores() {
    const scores = new Map<string, number>();
    for (const edge of this.edges) {
      scores.set(edge.to, (scores.get(edge.to) ?? 0) + edge.influence * (edge.confidence / 100));
      scores.set(edge.from, Math.max(scores.get(edge.from) ?? 0, this.nodes.get(edge.from)?.confidence ?? 0));
    }
    return Array.from(scores.entries())
      .map(([nodeId, score]) => ({ nodeId, score: round(score) }))
      .sort((left, right) => right.score - left.score);
  }

  snapshot(startNodeId: string | null, generatedAt = new Date().toISOString()): MemoryGraphReport {
    return {
      generatedAt,
      nodes: Array.from(this.nodes.values()).sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
      edges: [...this.edges].sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
      traversal: this.traverse(startNodeId),
      influenceScores: this.influenceScores(),
    };
  }

  private upsertNode(id: string, record: GraphRecord): MemoryGraphNode {
    const existing = this.nodes.get(id);
    const merged: MemoryGraphNode = existing
      ? {
          ...existing,
          label: record.label,
          confidence: round((existing.confidence + record.confidence) / 2),
          timestamp: existing.timestamp > record.timestamp ? existing.timestamp : record.timestamp,
          sourceCount: existing.sourceCount + record.sourceCount,
          metadata: { ...existing.metadata, ...record.metadata },
        }
      : {
          id,
          kind: record.kind,
          label: record.label,
          confidence: round(record.confidence),
          timestamp: record.timestamp,
          metadata: { ...record.metadata },
          sourceCount: record.sourceCount,
        };
    this.nodes.set(id, merged);
    return merged;
  }

  private link(from: MemoryGraphNode, to: MemoryGraphNode, type: string, confidence: number, timestamp: string) {
    this.edges.push({
      id: randomUUID(),
      from: from.id,
      to: to.id,
      type,
      confidence: round(confidence * 100),
      influence: round((from.confidence + to.confidence) / 2),
      timestamp,
    });
  }
}

export class StrategyEvolutionService {
  analyze(input: {
    strategies: StrategyDefinition[];
    validations: StrategyValidationScorecard[];
    validationInputs: StrategyValidationInput[];
    closedTrades: ClosedPaperTrade[];
    lifecycleReports: StrategyLifecycleReport[];
    adaptations: StrategyAdaptationSuggestion[];
  }, now = new Date(), evidenceRecords: StrategyEvidenceRecord[] = []): StrategyEvolutionReport[] {
    const validationInputByStrategy = new Map(input.validationInputs.map((item) => [item.strategyId, item] as const));
    const scorecardByStrategy = new Map(input.validations.map((item) => [item.strategyId, item] as const));
    const tradesByStrategy = groupBy(input.closedTrades, (trade) => trade.strategyId);
    const lifecycleByStrategy = new Map(input.lifecycleReports.map((report) => [report.strategyId, report] as const));
    const evidenceByStrategy = groupBy(evidenceRecords, (record) => record.strategyId);

    return input.strategies.map((strategy) => {
      const trades = tradesByStrategy.get(strategy.id) ?? [];
      const scorecard = scorecardByStrategy.get(strategy.id);
      const validationInput = validationInputByStrategy.get(strategy.id);
      const lifecycle = lifecycleByStrategy.get(strategy.id);
      const evidence = evidenceByStrategy.get(strategy.id) ?? [];
      const sampleDepth = sampleDepthService.analyze(evidenceRecords, strategy.id);
      const tradeStats = tradeMetrics(trades);
      const baseScore = scorecard?.overallScore ?? 50;
      const robustnessScore = validationInput
        ? round(
            clamp(
              100
              - validationInput.walkForward.degradationPct * 1.1
              - validationInput.monteCarlo.riskOfRuinPct * 1.2
              - Math.max(0, 50 - validationInput.walkForward.profitableWindowsPct),
            ),
          )
        : clamp(baseScore);
      const overfittingRisk = validationInput
        ? round(clamp(
            validationInput.walkForward.degradationPct * 1.2
            + (scorecard?.overfittingWarning ? 20 : 0)
            + (scorecard?.regimeSensitivity === "high" ? 15 : 0),
          ))
        : scorecard?.overfittingWarning ? 65 : 35;
      const fragileParameters = [
        validationInput?.walkForward.degradationPct && validationInput.walkForward.degradationPct > 25 ? "Walk-forward degradation is elevated" : null,
        validationInput?.monteCarlo.riskOfRuinPct && validationInput.monteCarlo.riskOfRuinPct > 10 ? "Monte Carlo ruin risk is elevated" : null,
        scorecard?.tradeCountSufficiency !== undefined && scorecard.tradeCountSufficiency < 40 ? "Trade count is thin" : null,
      ].filter((item): item is string => Boolean(item));
      const narrowOptima = [
        scorecard?.regimeSensitivity === "high" ? "Performance is regime-sensitive" : null,
        scorecard?.symbolSuitability !== undefined && scorecard.symbolSuitability < 55 ? "Symbol fit is weak or unproven" : null,
      ].filter((item): item is string => Boolean(item));
      const unstablePerformance = [
        tradeStats.sampleSize >= 6 && tradeStats.recentWinRate + 0.15 < tradeStats.winRate ? "Recent win rate has slipped versus history" : null,
        tradeStats.sampleSize >= 6 && tradeStats.recentExpectancy + 0.1 < tradeStats.expectancy ? "Recent expectancy is below historical expectancy" : null,
        tradeStats.sampleSize >= 6 && tradeStats.recentDrawdown > tradeStats.maxDrawdown ? "Recent drawdown is worsening" : null,
      ].filter((item): item is string => Boolean(item));
      const regimePerformance = regimePerformanceFromValidation(validationInput, trades);
      const symbolSuitability = symbolSuitabilityReport(validationInput, trades);
      const retirement = retirementVerdict({
        lifecycle,
        scorecard,
        tradeStats,
        overfittingRisk,
        sampleDepth,
        evidenceScore: scorecard?.overallScore ?? baseScore,
      });
      const calibrationScore = calibrationScoreFromScorecard(scorecard, sampleDepth);
      const riskAdjustedReturnScore = riskAdjustedReturnScoreFromTrades(tradeStats);
      const regretScore = regretScoreFromEvidence({ trades, evidence, lifecycle });
      const regimeCoverageScore = coverageScore(sampleDepth.regimesTested.length, 4);
      const symbolCoverageScore = coverageScore(sampleDepth.symbolsTested.length, 7);
      const behavioralPenalty = behavioralPenaltyFromSignals({
        scorecard,
        lifecycle,
        tradeStats,
        evidence,
      });
      const scoreEvolution = combineScoreEvolution({
        baseScore,
        tradeStats,
        robustnessScore,
        overfittingRisk,
        lifecycle,
        scorecard,
        regimePerformance,
        sampleDepth,
        calibrationScore,
        riskAdjustedReturnScore,
        regretScore,
        regimeCoverageScore,
        symbolCoverageScore,
        behavioralPenalty,
      });
      const confidence = round(clamp(
        confidenceFromSample(trades.length, validationInput, scorecard)
        + sampleDepth.score * 0.1
        + calibrationScore * 0.08
        - behavioralPenalty * 0.08,
      ));
      const evidenceRankingScore = round(clamp(
        baseScore * 0.22
        + robustnessScore * 0.16
        + scoreEvolution.overallScore * 0.16
        + sampleDepth.score * 0.16
        + regretScore * 0.1
        + calibrationScore * 0.08
        + riskAdjustedReturnScore * 0.08
        + regimeCoverageScore * 0.02
        + symbolCoverageScore * 0.02
        + (100 - behavioralPenalty) * 0.04,
      ));
      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        strategyType: strategy.type,
        sampleSize: trades.length,
        overallScore: evidenceRankingScore,
        confidence,
        verdict: retirement.verdict,
        parameterStability: {
          robustnessScore,
          overfittingRisk,
          fragileParameters,
          narrowOptima,
          unstablePerformance,
          recommendations: recommendationList([
            fragileParameters.length ? "Tighten validation around the fragile parameter set." : null,
            narrowOptima.length ? "Treat the strategy as regime-conditional until stability improves." : null,
            overfittingRisk > 60 ? "Prefer paper tracking and avoid expanding size." : null,
          ]),
        },
        regimePerformance,
        symbolSuitability,
        retirement,
        scoreEvolution,
        evidenceRankingScore,
        validationScore: round(baseScore),
        sampleDepthScore: sampleDepth.score,
        regretScore,
        calibrationScore,
        riskAdjustedReturnScore,
        regimeCoverageScore,
        symbolCoverageScore,
        behavioralPenalty,
        evidenceDepth: sampleDepth,
        verdictExplanation: explainVerdict({
          report: strategy,
          scorecard,
          validationInput,
          sampleDepth,
          tradeStats,
          retirement,
          evidenceRankingScore,
          calibrationScore,
          regretScore,
          riskAdjustedReturnScore,
          regimeCoverageScore,
          symbolCoverageScore,
          behavioralPenalty,
          scoreEvolution,
        }),
      };
    });
  }
}

export class RegretAnalysisService {
  analyze(input: {
    closedTrades: ClosedPaperTrade[];
    postTradeReviews: PostTradeReview[];
    adaptations: StrategyAdaptationSuggestion[];
  }, now = new Date()): RegretAnalysisReport {
    const reviewByTradeId = new Map(input.postTradeReviews.map((review) => [review.tradeId, review] as const));
    const regretItems: RegretItem[] = [];
    const missedEvidenceCount = input.postTradeReviews.filter((review) => review.missedEvidence.length > 0).length;
    const badExits = input.closedTrades.filter((trade) => trade.realizedPnL < 0 && (trade.exitReason === "stop_loss" || trade.exitReason === "manual")).length;
    const earlyExits = input.closedTrades.filter((trade) => isEarlyExit(trade)).length;
    const lateExits = input.closedTrades.filter((trade) => isLateExit(trade)).length;
    const skippedWinners = input.postTradeReviews.filter((review) => review.result === "win" && review.missedEvidence.length > 0).length;
    const unnecessaryLosses = input.closedTrades.filter((trade) => trade.realizedPnL < 0 && trade.realizedPnL <= -trade.riskTaken * 0.75).length;

    regretItems.push({
      pattern: "missed_trades",
      count: missedEvidenceCount,
      latestEvidence: input.postTradeReviews.find((review) => review.missedEvidence.length > 0)?.missedEvidence[0] ?? "No missed-evidence sample recorded.",
      learningNote: "Require the user to name the missing evidence before the next similar setup.",
      confidenceUpdate: missedEvidenceCount > 0 ? -5 : 0,
    });
    regretItems.push({
      pattern: "bad_exits",
      count: badExits,
      latestEvidence: input.closedTrades.find((trade) => trade.realizedPnL < 0 && (trade.exitReason === "stop_loss" || trade.exitReason === "manual"))?.exitReason ?? "No bad-exit sample recorded.",
      learningNote: "Review exit logic against adverse excursion and avoid moving stops without a rule.",
      confidenceUpdate: badExits > 0 ? -6 : 0,
    });
    regretItems.push({
      pattern: "early_exits",
      count: earlyExits,
      latestEvidence: input.closedTrades.find((trade) => isEarlyExit(trade))?.id ?? "No early-exit sample recorded.",
      learningNote: "Check whether the exit cut a trade before the thesis finished playing out.",
      confidenceUpdate: earlyExits > 0 ? -4 : 0,
    });
    regretItems.push({
      pattern: "late_exits",
      count: lateExits,
      latestEvidence: input.closedTrades.find((trade) => isLateExit(trade))?.id ?? "No late-exit sample recorded.",
      learningNote: "Wait less when the thesis is invalidated; late exits usually compound damage.",
      confidenceUpdate: lateExits > 0 ? -5 : 0,
    });
    regretItems.push({
      pattern: "skipped_winners",
      count: skippedWinners,
      latestEvidence: skippedWinners > 0 ? "A winner was accompanied by missing evidence, so similar setups may be skipped too often." : "No skipped-winner proxy recorded.",
      learningNote: "Use evidence thresholds rather than a blanket hesitation rule.",
      confidenceUpdate: skippedWinners > 0 ? -3 : 0,
    });
    regretItems.push({
      pattern: "unnecessary_losses",
      count: unnecessaryLosses,
      latestEvidence: input.closedTrades.find((trade) => trade.realizedPnL < 0 && trade.realizedPnL <= -trade.riskTaken * 0.75)?.id ?? "No unnecessary-loss sample recorded.",
      learningNote: "Reduce size or avoid the setup if the same trade repeatedly eats most of the planned risk.",
      confidenceUpdate: unnecessaryLosses > 0 ? -7 : 0,
    });

    const learningNotes = regretItems
      .filter((item) => item.count > 0)
      .map((item) => item.learningNote)
      .slice(0, 5);
    const confidenceUpdates = regretItems
      .filter((item) => item.confidenceUpdate !== 0)
      .map((item) => `${item.pattern}: ${item.confidenceUpdate > 0 ? "+" : ""}${item.confidenceUpdate}`);
    const regretScore = round(clamp(100 - regretItems.reduce((sum, item) => sum + item.count * 8, 0)));

    return {
      generatedAt: now.toISOString(),
      items: regretItems,
      regretScore,
      learningNotes,
      confidenceUpdates,
    };
  }
}

export class PerformanceDecayService {
  analyze(input: {
    strategies: StrategyDefinition[];
    closedTrades: ClosedPaperTrade[];
  }, now = new Date()): PerformanceDecayReport {
    const tradesByStrategy = groupBy(input.closedTrades, (trade) => trade.strategyId);
    const items = input.strategies.map((strategy) => {
      const trades = tradesByStrategy.get(strategy.id) ?? [];
      const verdict: PerformanceDecayItem["verdict"] = decayVerdict(trades);
      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        verdict,
        rollingSharpeDeterioration: rollingDeterioration(trades, (window) => sharpe(normalizedTradeReturns(window))),
        drawdownIncrease: rollingDeterioration(trades, (window) => maxDrawdown(normalizedTradeReturns(window))),
        expectancyDrop: rollingDeterioration(trades, (window) => expectancy(normalizedTradeReturns(window))),
        winRateDrop: rollingDeterioration(trades, (window) => winRate(normalizedTradeReturns(window))),
        volatilityMismatch: rollingDeterioration(trades, (window) => volatility(normalizedTradeReturns(window))),
        reasons: decayReasons(trades, verdict),
      };
    });
    return {
      generatedAt: now.toISOString(),
      items,
    };
  }
}

export class StrategyLabService {
  private readonly evolution = new StrategyEvolutionService();
  private readonly regret = new RegretAnalysisService();
  private readonly decay = new PerformanceDecayService();

  build(input: StrategyLabInput, now = new Date()): StrategyLabSnapshot {
    const evidenceSnapshot = strategyEvidenceStore.snapshot(now);
    const evidenceRecords = input.evidenceRecords ?? evidenceSnapshot.records;
    const confidenceCalibration = calibrate(input.predictionReviews, now);
    const recurringMistakes = detectRecurringMistakes({
      predictionReviews: input.predictionReviews,
      postTradeReviews: input.postTradeReviews,
      adaptations: input.adaptations,
      journalReviews: input.journalReviews ?? [],
    }, now);
    const strategyEvolution = this.evolution.analyze({
      strategies: input.strategies,
      validations: input.scorecards,
      validationInputs: input.validationInputs,
      closedTrades: input.closedTrades,
      lifecycleReports: input.lifecycleReports,
      adaptations: input.adaptations,
    }, now, evidenceRecords);
    const performanceDecay = this.decay.analyze({
      strategies: input.strategies,
      closedTrades: input.closedTrades,
    }, now);
    const regretAnalysis = this.regret.analyze({
      closedTrades: input.closedTrades,
      postTradeReviews: input.postTradeReviews,
      adaptations: input.adaptations,
    }, now);
    const counterfactualAnalysis = simulateCounterfactuals(input.closedTrades, now);
    const crossStrategyComparison = compareStrategyTypes(input.strategies, input.closedTrades, input.scorecards, regretAnalysis, now);
    const learningPriorities = prioritizeLearning({
      recurringMistakes,
      performanceDecay,
      strategyEvolution,
      confidenceCalibration,
      regretAnalysis,
    }, now);
    const memoryGraph = this.buildMemoryGraph(input, now);
    const strategyById = new Map(input.strategies.map((strategy) => [strategy.id, strategy] as const));
    const topStrategies = [...strategyEvolution]
      .sort((left, right) => right.overallScore - left.overallScore || right.confidence - left.confidence)
      .slice(0, 3);
    const weakStrategies = [...strategyEvolution]
      .sort((left, right) => left.overallScore - right.overallScore || left.confidence - right.confidence)
      .slice(0, 3);
    const retirementCandidates = [...strategyEvolution]
      .filter((report) => report.verdict === "pause" || report.verdict === "retire")
      .sort((left, right) => left.overallScore - right.overallScore || left.confidence - right.confidence)
      .slice(0, 3);
    const evidenceDepth = strategyEvolution.map((report) => report.evidenceDepth);
    const closedTradeHistory = buildClosedTradeHistory(evidenceRecords, strategyById);
    const rejectedSignalLearning = buildRejectedSignalLearning(evidenceSnapshot.rejectedSignals, strategyById);
    const verdictExplanations = strategyEvolution.map((report) => ({
      strategyId: report.strategyId,
      strategyName: report.strategyName,
      verdict: report.verdict,
      overallScore: report.overallScore,
      sampleDepthSufficient: report.verdictExplanation.sampleDepthSufficient,
      whyRankedThisWay: report.verdictExplanation.whyRankedThisWay,
      strongestEvidence: report.verdictExplanation.strongestEvidence,
      weakestEvidence: report.verdictExplanation.weakestEvidence,
      missingEvidence: report.verdictExplanation.missingEvidence,
      confidenceImprovement: report.verdictExplanation.confidenceImprovement,
    }));
    const adaptationSuggestions = input.adaptations
      .slice(0, 5)
      .map((suggestion) => ({
        strategyId: suggestion.strategyId,
        type: suggestion.type,
        reason: suggestion.reason,
        status: suggestion.status,
      }));
    const latestLessons = buildLatestLessons(input, recurringMistakes, regretAnalysis);
    return {
      generatedAt: now.toISOString(),
      topStrategies,
      weakStrategies,
      retirementCandidates,
      adaptationSuggestions,
      latestLessons,
      memoryGraph,
      recurringMistakes,
      confidenceCalibration,
      strategyEvolution,
      regretAnalysis,
      counterfactualAnalysis,
      performanceDecay,
      crossStrategyComparison,
      learningPriorities,
      evidenceDepth,
      closedTradeHistory,
      rejectedSignalLearning,
      verdictExplanations,
    };
  }

  private buildMemoryGraph(input: StrategyLabInput, now: Date) {
    const graph = new MemoryGraphService();
    for (const review of input.postTradeReviews) {
      const trade = input.closedTrades.find((item) => item.id === review.tradeId);
      if (!trade) continue;
      const strategy = input.strategies.find((item) => item.id === trade.strategyId);
      const adaptation = input.adaptations.find((item) => item.strategyId === trade.strategyId);
      graph.recordChain({
        lesson: review.updatedLesson,
        mistake: review.missedEvidence[0] ?? review.whatFailed[0] ?? review.exitReason,
        strategyId: trade.strategyId,
        strategyName: strategy?.name ?? trade.strategyId,
        asset: trade.symbol,
        outcome: review.result,
        reviewId: review.id,
        updatedRule: review.strategyImprovementNote,
        reminder: adaptation?.reason ?? review.updatedLesson,
        futureTrade: adaptation?.id ?? `${trade.strategyId}-${review.id}`,
        confidence: Math.max(35, 100 - Math.abs(review.strategyValidationScoreDelta) * 8),
        timestamp: review.reviewedAt,
      });
    }
    const startNodeId = input.postTradeReviews[0] ? nodeId("lesson", input.postTradeReviews[0].updatedLesson) : null;
    return graph.snapshot(startNodeId, now.toISOString());
  }
}

function calibrate(predictionReviews: PredictionReview[], now = new Date()): ConfidenceCalibrationReport {
  const items: ConfidenceCalibrationItem[] = predictionReviews.map((review) => ({
    predictionId: review.predictionId,
    confidence: review.confidence,
    outcome: review.actualOutcome,
    wasOverconfident: review.shouldConfidenceModelChange || isNegativeOutcome(review.actualOutcome),
  }));
  const totalReviews = items.length;
  const expectedAccuracy = totalReviews ? round(items.reduce((sum, item) => sum + item.confidence, 0) / totalReviews / 100) : 0;
  const observedAccuracy = totalReviews ? round(items.filter((item) => !item.wasOverconfident).length / totalReviews) : 0;
  const calibrationDrift = round(expectedAccuracy - observedAccuracy);
  const overconfidenceTendency = totalReviews ? round(items.filter((item) => item.wasOverconfident && item.confidence >= 70).length / totalReviews) : 0;
  const confidenceAdjustmentSuggestions = [
    calibrationDrift > 0.1 ? "Lower confidence by 10 points when evidence is thin or contradictory." : "Confidence calibration is currently stable.",
    overconfidenceTendency > 0.25 ? "Require an explicit disconfirming check before acting on high-confidence predictions." : "Keep the current confidence gate, but continue monitoring.",
  ];
  return {
    generatedAt: now.toISOString(),
    totalReviews,
    expectedAccuracy,
    observedAccuracy,
    calibrationDrift,
    overconfidenceTendency,
    items,
    confidenceAdjustmentSuggestions,
  };
}

function detectRecurringMistakes(input: {
  predictionReviews: PredictionReview[];
  postTradeReviews: PostTradeReview[];
  adaptations: StrategyAdaptationSuggestion[];
  journalReviews: JournalReview[];
}, now = new Date()): RecurringMistakeReport {
  const textSources = [
    ...input.predictionReviews.map((review) => `${review.actualOutcome} ${review.futureRuleAdjustment} ${review.whatWasMissed.join(" ")}`),
    ...input.postTradeReviews.map((review) => `${review.updatedLesson} ${review.strategyImprovementNote} ${review.missedEvidence.join(" ")} ${review.whatFailed.join(" ")}`),
    ...input.adaptations.map((item) => `${item.type} ${item.reason}`),
    ...input.journalReviews.map((item) => `${item.feedback.join(" ")} ${item.mistakePatterns.join(" ")} ${item.disciplineSignals.join(" ")}`),
  ];
  const overconfidence = countMatches(textSources, /overconfident|over-confidence|confidence.*too high/i) + input.predictionReviews.filter((item) => item.shouldConfidenceModelChange && item.confidence >= 70).length;
  const revenge = countMatches(textSources, /revenge/i) + input.journalReviews.filter((item) => item.mistakePatterns.some((pattern) => /revenge/i.test(pattern))).length;
  const fomo = countMatches(textSources, /\bfomo\b|fear of missing out|chased the move|late entry/i);
  const oversized = countMatches(textSources, /oversized|reduce_size|position sizing|too large/i) + input.journalReviews.filter((item) => item.mistakePatterns.some((pattern) => /position sizing/i.test(pattern) || /Weak position sizing/.test(pattern))).length;
  const stopWidening = countMatches(textSources, /widen_stop|stop widen|moved stop|widened stop|stop discipline/i);
  const strategySwitching = countMatches(textSources, /strategy hopping|strategy switch|switching strategies|hopping between/i);
  const items: RecurringMistakeItem[] = [
    recurringItem("overconfidence", overconfidence, "Require a disconfirming check before the next high-confidence decision.", textSources, now),
    recurringItem("revenge_trading", revenge, "Insert a cooling-off period and a journal review before the next trade.", textSources, now),
    recurringItem("fomo", fomo, "Slow the entry process and require a written trigger checklist.", textSources, now),
    recurringItem("oversized_positions", oversized, "Reduce size until the trade is consistent with the risk plan.", textSources, now),
    recurringItem("stop_widening", stopWidening, "Freeze stop logic unless a pre-written rule justifies the change.", textSources, now),
    recurringItem("strategy_switching", strategySwitching, "Keep the same strategy long enough to learn from evidence.", textSources, now),
  ].filter((item) => item.count > 0 || item.pattern === "overconfidence");
  const sorted = items.sort((left, right) => right.lessonPriority - left.lessonPriority);
  return {
    generatedAt: now.toISOString(),
    items: sorted,
    interventionRecommendation: sorted[0]?.interventionRecommendation ?? "No recurring mistake pattern crossed the intervention threshold.",
    lessonPriority: sorted[0]?.lessonPriority ?? 0,
  };
}

function compareStrategyTypes(
  strategies: StrategyDefinition[],
  closedTrades: ClosedPaperTrade[],
  scorecards: StrategyValidationScorecard[],
  regretAnalysis: RegretAnalysisReport,
  now = new Date(),
): CrossStrategyComparisonReport {
  const order = ["trend-following", "breakout", "RSI", "volatility", "news-event"];
  const typeMap = new Map<string, string>([
    ["trend_following", "trend-following"],
    ["moving_average_crossover", "trend-following"],
    ["breakout", "breakout"],
    ["rsi_mean_reversion", "RSI"],
    ["volatility_breakout", "volatility"],
    ["news_event", "news-event"],
    ["custom_rule", "trend-following"],
    ["carry_trade", "volatility"],
  ]);
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy] as const));
  const scorecardByStrategy = new Map(scorecards.map((scorecard) => [scorecard.strategyId, scorecard] as const));
  const grouped = groupBy(closedTrades, (trade) => typeMap.get(strategyById.get(trade.strategyId)?.type ?? "") ?? "trend-following");
  const items = order.map((strategyType) => {
    const trades = grouped.get(strategyType) ?? [];
    const normalized = tradeMetrics(trades);
    const matchingStrategies = strategies.filter((strategy) => (typeMap.get(strategy.type) ?? "trend-following") === strategyType);
    const robustness = matchingStrategies.length
      ? round(matchingStrategies.reduce((sum, strategy) => sum + (scorecardByStrategy.get(strategy.id)?.overallScore ?? 50), 0) / matchingStrategies.length)
      : 45;
    const regretPenalty = regretAnalysis.items.reduce((sum, item) => sum + item.count * (item.pattern === "unnecessary_losses" ? 3 : 2), 0);
    return {
      strategyType,
      expectancy: normalized.expectancy,
      drawdown: normalized.maxDrawdown,
      consistency: round(clamp(normalized.winRate * 100 - normalized.volatility * 20)),
      robustness,
      regretScore: round(clamp(100 - regretPenalty)),
      tradeCount: normalized.sampleSize,
      rank: 0,
    };
  }).sort((left, right) => right.expectancy - left.expectancy || right.robustness - left.robustness);
  items.forEach((item, index) => {
    item.rank = index + 1;
  });
  return {
    generatedAt: now.toISOString(),
    items,
    summary: [
      items[0] ? `${items[0].strategyType} is the current leader.` : "No comparison data available.",
      items.find((item) => item.tradeCount === 0) ? "Some strategy families still need more closed-trade evidence." : "All strategy families have at least one closed trade sample.",
    ],
  };
}

function calibrationScoreFromScorecard(scorecard: StrategyValidationScorecard | undefined, sampleDepth: StrategyEvidenceDepthReport) {
  if (!scorecard) {
    return sampleDepth.verdict === "robust" ? 75 : sampleDepth.verdict === "acceptable" ? 62 : sampleDepth.verdict === "developing" ? 48 : 35;
  }
  const penalty = (scorecard.overfittingWarning ? 15 : 0) + (scorecard.regimeSensitivity === "high" ? 10 : 0) + (scorecard.tradeCountSufficiency < 35 ? 8 : 0);
  return round(clamp(scorecard.overallScore - penalty + sampleDepth.score * 0.12));
}

function riskAdjustedReturnScoreFromTrades(tradeStats: ReturnType<typeof tradeMetrics>) {
  return round(clamp(50 + tradeStats.expectancy * 18 + tradeStats.winRate * 20 - tradeStats.maxDrawdown * 4 - tradeStats.volatility * 10));
}

function regretScoreFromEvidence(input: { trades: ClosedPaperTrade[]; evidence: StrategyEvidenceRecord[]; lifecycle?: StrategyLifecycleReport }) {
  const reviewCount = input.evidence.filter((record) => record.kind === "post_trade_review").length;
  const rejectedSignals = input.evidence.filter((record) => record.kind === "rejected_signal").length;
  const losses = input.trades.filter((trade) => trade.realizedPnL < 0).length;
  const manualStops = input.trades.filter((trade) => trade.exitReason === "manual").length;
  const lifecyclePenalty = input.lifecycle?.decayDetected ? 8 : 0;
  return round(clamp(100 - (losses * 5 + manualStops * 4 + rejectedSignals * 3 + reviewCount * 2 + lifecyclePenalty)));
}

function behavioralPenaltyFromSignals(input: {
  scorecard?: StrategyValidationScorecard;
  lifecycle?: StrategyLifecycleReport;
  tradeStats: ReturnType<typeof tradeMetrics>;
  evidence: StrategyEvidenceRecord[];
}) {
  const rejectedSignals = input.evidence.filter((record) => record.kind === "rejected_signal").length;
  const postTradeReviews = input.evidence.filter((record) => record.kind === "post_trade_review").length;
  return round(clamp(
    (input.scorecard?.overfittingWarning ? 15 : 0)
    + (input.scorecard?.regimeSensitivity === "high" ? 10 : 0)
    + (input.lifecycle?.decayDetected ? 12 : 0)
    + (input.tradeStats.recentExpectancy < input.tradeStats.expectancy ? 8 : 0)
    + Math.max(0, rejectedSignals * 3 - postTradeReviews * 2),
  ));
}

function coverageScore(count: number, scale: number) {
  return round(clamp((count / Math.max(1, scale)) * 100));
}

function explainVerdict(input: {
  report: StrategyDefinition;
  scorecard?: StrategyValidationScorecard;
  validationInput?: StrategyValidationInput;
  sampleDepth: StrategyEvidenceDepthReport;
  tradeStats: ReturnType<typeof tradeMetrics>;
  retirement: { verdict: StrategyEvolutionReport["verdict"]; reasons: string[] };
  evidenceRankingScore: number;
  calibrationScore: number;
  regretScore: number;
  riskAdjustedReturnScore: number;
  regimeCoverageScore: number;
  symbolCoverageScore: number;
  behavioralPenalty: number;
  scoreEvolution: StrategyEvolutionReport["scoreEvolution"];
}): StrategyVerdictExplanation {
  const strongestEvidence = recommendationList([
    input.scorecard ? `Validation score ${input.scorecard.overallScore}` : null,
    input.sampleDepth.verdict !== "insufficient" ? `Sample depth ${input.sampleDepth.verdict}` : null,
    input.tradeStats.sampleSize > 0 ? `Closed trades ${input.tradeStats.sampleSize}` : null,
    input.regretScore >= 70 ? `Regret score ${input.regretScore}` : null,
    input.calibrationScore >= 70 ? `Calibration score ${input.calibrationScore}` : null,
  ]);
  const weakestEvidence = recommendationList([
    input.sampleDepth.verdict === "insufficient" ? "Trade sample is still thin." : null,
    input.sampleDepth.regimesTested.length < 2 ? "Regime coverage is narrow." : null,
    input.sampleDepth.symbolsTested.length < 2 ? "Symbol coverage is narrow." : null,
    input.scorecard?.overfittingWarning ? "Validation shows overfitting risk." : null,
    input.behavioralPenalty > 30 ? "Behavioral penalties are elevated." : null,
  ]);
  const missingEvidence = recommendationList([
    input.sampleDepth.minimumEvidenceThreshold ? null : "Need more closed trades across symbols and regimes.",
    input.sampleDepth.stressScenarioCoverage < 3 ? "Need more stress scenarios and reviews." : null,
    input.validationInput ? null : "Need more validation inputs on the next run.",
  ]);
  const whyRankedThisWay = recommendationList([
    `${input.report.name} is ranked with evidence across validation and closed trades.`,
    `Evidence ranking score ${input.evidenceRankingScore}/100.`,
    input.scoreEvolution.reasons[0] ?? null,
    input.retirement.reasons[0] ? `Retirement review: ${input.retirement.reasons[0]}` : null,
    input.sampleDepth.verdict !== "insufficient" ? `Sample depth is ${input.sampleDepth.verdict}.` : "Sample depth is still insufficient.",
    input.regimeCoverageScore >= 50 ? "Regime coverage is broad enough to support the current ranking." : null,
    input.symbolCoverageScore >= 50 ? "Symbol coverage is broad enough to support the current ranking." : null,
  ]);
  const confidenceImprovement = recommendationList([
    input.behavioralPenalty > 20 ? "Reduce behavioral penalties before increasing confidence." : null,
    input.calibrationScore < 60 ? "Improve calibration consistency before taking the next step." : null,
    input.regretScore < 60 ? "Address regret patterns and closed-trade mistakes." : null,
    input.sampleDepth.verdict === "insufficient" ? "Collect more trades, regimes, and symbols." : null,
  ]);
  return {
    whyRankedThisWay,
    strongestEvidence,
    weakestEvidence,
    missingEvidence,
    confidenceImprovement,
    sampleDepthSufficient: input.sampleDepth.minimumEvidenceThreshold,
  };
}

function prioritizeLearning(input: {
  recurringMistakes: RecurringMistakeReport;
  performanceDecay: PerformanceDecayReport;
  strategyEvolution: StrategyEvolutionReport[];
  confidenceCalibration: ConfidenceCalibrationReport;
  regretAnalysis: RegretAnalysisReport;
}, now = new Date()): LearningPriorityReport {
  const items: LearningPriorityItem[] = [];
  const topMistake = input.recurringMistakes.items[0];
  if (topMistake) {
    items.push({
      id: `mistake-${topMistake.pattern}`,
      lessonPriority: topMistake.lessonPriority,
      urgency: urgencyFor(topMistake.lessonPriority),
      title: `${prettyPattern(topMistake.pattern)} correction`,
      explanation: topMistake.interventionRecommendation,
      relatedStrategies: [],
    });
  }
  const weakestStrategy = [...input.strategyEvolution].sort((left, right) => left.overallScore - right.overallScore)[0];
  if (weakestStrategy) {
    items.push({
      id: `strategy-${weakestStrategy.strategyId}`,
      lessonPriority: clamp(100 - weakestStrategy.overallScore),
      urgency: urgencyFor(100 - weakestStrategy.overallScore),
      title: `Review ${weakestStrategy.strategyName}`,
      explanation: `Score ${weakestStrategy.overallScore}; ${weakestStrategy.retirement.verdict} verdict; ${weakestStrategy.parameterStability.recommendations[0] ?? "stability needs attention"}.`,
      relatedStrategies: [weakestStrategy.strategyId],
    });
  }
  const decayItem = input.performanceDecay.items.find((item) => item.verdict === "pause" || item.verdict === "retire");
  if (decayItem) {
    items.push({
      id: `decay-${decayItem.strategyId}`,
      lessonPriority: clamp(85 + (decayItem.verdict === "retire" ? 10 : 0)),
      urgency: decayItem.verdict === "retire" ? "critical" : "high",
      title: `${decayItem.strategyName} decay`,
      explanation: decayItem.reasons[0] ?? "Performance decay is visible in the recent sample.",
      relatedStrategies: [decayItem.strategyId],
    });
  }
  if (input.confidenceCalibration.calibrationDrift > 0.1) {
    items.push({
      id: "confidence-calibration",
      lessonPriority: clamp(70 + input.confidenceCalibration.calibrationDrift * 100),
      urgency: "high",
      title: "Confidence calibration",
      explanation: input.confidenceCalibration.confidenceAdjustmentSuggestions[0] ?? "Reduce confidence until calibration improves.",
      relatedStrategies: [],
    });
  }
  if (input.regretAnalysis.items.some((item) => item.count > 0)) {
    items.push({
      id: "regret-analysis",
      lessonPriority: clamp(65 + input.regretAnalysis.regretScore / 2),
      urgency: "medium",
      title: "Regret review",
      explanation: input.regretAnalysis.learningNotes[0] ?? "Regret analysis found repeated avoidable friction.",
      relatedStrategies: [],
    });
  }
  const sorted = items
    .sort((left, right) => right.lessonPriority - left.lessonPriority)
    .slice(0, 5);
  return {
    generatedAt: now.toISOString(),
    items: sorted,
  };
}

function simulateCounterfactuals(trades: ClosedPaperTrade[], now = new Date()): CounterfactualAnalysisReport {
  const items = trades.map((trade) => {
    const scenarios: CounterfactualScenarioResult[] = [
      {
        scenario: "tighter_stop",
        estimatedPnL: round(trade.realizedPnL >= 0 ? trade.realizedPnL * 0.75 : trade.realizedPnL * 0.65),
        deltaFromActual: round((trade.realizedPnL >= 0 ? trade.realizedPnL * 0.75 : trade.realizedPnL * 0.65) - trade.realizedPnL),
        explanation: trade.realizedPnL >= 0 ? "A tighter stop would likely have clipped part of the win." : "A tighter stop may have reduced the loss sooner.",
      },
      {
        scenario: "wider_stop",
        estimatedPnL: round(trade.realizedPnL >= 0 ? trade.realizedPnL * 0.9 : Math.max(trade.realizedPnL * 0.8, -trade.riskTaken * 0.45)),
        deltaFromActual: round((trade.realizedPnL >= 0 ? trade.realizedPnL * 0.9 : Math.max(trade.realizedPnL * 0.8, -trade.riskTaken * 0.45)) - trade.realizedPnL),
        explanation: trade.realizedPnL >= 0 ? "A wider stop would not materially change a winning sample." : "A wider stop might have prevented a shallow stop-out, but risk would rise.",
      },
      {
        scenario: "no_trade",
        estimatedPnL: 0,
        deltaFromActual: round(0 - trade.realizedPnL),
        explanation: "Skipping the trade avoids both the gain and the loss, useful only as a baseline.",
      },
      {
        scenario: "reduced_size",
        estimatedPnL: round(trade.realizedPnL * 0.5),
        deltaFromActual: round(trade.realizedPnL * 0.5 - trade.realizedPnL),
        explanation: "Halving size would have cut both profit and loss in equal proportion.",
      },
      {
        scenario: "different_target",
        estimatedPnL: round(trade.realizedPnL >= 0 ? trade.realizedPnL * 1.15 : trade.realizedPnL * 0.95),
        deltaFromActual: round((trade.realizedPnL >= 0 ? trade.realizedPnL * 1.15 : trade.realizedPnL * 0.95) - trade.realizedPnL),
        explanation: trade.realizedPnL >= 0 ? "A larger target may have captured more of the move, if liquidity allowed." : "A different target probably would not rescue the loss on its own.",
      },
      {
        scenario: "trailing_stop",
        estimatedPnL: round(trade.realizedPnL >= 0 ? Math.max(trade.realizedPnL, trade.realizedPnL * 0.85) : trade.realizedPnL * 0.9),
        deltaFromActual: round((trade.realizedPnL >= 0 ? Math.max(trade.realizedPnL, trade.realizedPnL * 0.85) : trade.realizedPnL * 0.9) - trade.realizedPnL),
        explanation: trade.realizedPnL >= 0 ? "A trailing stop would likely preserve more of the favorable excursion." : "A trailing stop usually helps more after the trade moves in your favor.",
      },
    ];
    return {
      tradeId: trade.id,
      strategyId: trade.strategyId,
      symbol: trade.symbol,
      actualPnL: round(trade.realizedPnL),
      scenarios,
    };
  });
  return {
    generatedAt: now.toISOString(),
    tradeCount: items.length,
    items,
    summary: items.length > 0
      ? [`Simulated ${items.length} closed trades for learning only.`, "Counterfactuals do not rewrite history or alter actual execution."]
      : ["No closed trades were available for counterfactual simulation."],
  };
}

function buildLatestLessons(
  input: StrategyLabInput,
  recurringMistakes: RecurringMistakeReport,
  regretAnalysis: RegretAnalysisReport,
) {
  const lessons = [
    ...input.postTradeReviews.slice(0, 2).map((review) => ({
      source: "post_trade_review",
      lesson: review.updatedLesson,
      strategyId: review.strategyId,
      timestamp: review.reviewedAt,
    })),
    ...input.predictionReviews.slice(0, 2).map((review) => ({
      source: "prediction_review",
      lesson: review.updatedLesson,
      strategyId: null,
      timestamp: review.reviewedAt,
    })),
    ...recurringMistakes.items.slice(0, 2).map((item) => ({
      source: "recurring_mistake",
      lesson: item.interventionRecommendation,
      strategyId: null,
      timestamp: recurringMistakes.generatedAt,
    })),
    ...regretAnalysis.learningNotes.slice(0, 2).map((note) => ({
      source: "regret",
      lesson: note,
      strategyId: null,
      timestamp: regretAnalysis.generatedAt,
    })),
  ];
  return lessons.slice(0, 5);
}

function buildClosedTradeHistory(
  evidenceRecords: StrategyEvidenceRecord[],
  strategyById: Map<string, StrategyDefinition>,
) {
  const closedTrades = evidenceRecords.filter((record) => record.kind === "paper_trade" || record.kind === "sandbox_trade");
  const grouped = groupBy(closedTrades, (record) => record.strategyId);
  return Array.from(grouped.entries())
    .map(([strategyId, trades]) => ({
      strategyId,
      strategyName: strategyById.get(strategyId)?.name ?? strategyId,
      trades: trades
        .slice(0, 8)
        .map((record) => {
          const metadata = record.metadata as Record<string, unknown>;
          const evidenceContext = metadata.evidenceContext as StrategyTradeEvidenceContext | undefined;
          const tradeLifecycle = metadata.tradeLifecycle as { timeline?: Array<{ createdAt: string }> } | undefined;
          const timeline = tradeLifecycle?.timeline ?? [];
          return {
            id: record.id,
            symbol: record.symbol ?? "unknown",
            tradeKind: record.kind as "paper_trade" | "sandbox_trade",
            verdict: record.verdict,
            outcome: record.outcome ?? "unknown",
            realizedPnL: typeof metadata.realizedPnL === "number" ? metadata.realizedPnL : undefined,
            exitReason: typeof metadata.exitReason === "string" ? metadata.exitReason : undefined,
            openedAt: timeline[0]?.createdAt ?? record.timestamp,
            closedAt: timeline[timeline.length - 1]?.createdAt ?? record.timestamp,
            regime: record.regime,
            timeframe: record.timeframe,
            originalStrategyInputs: evidenceContext?.originalStrategyInputs ?? null,
            signalFeatures: evidenceContext?.signalFeatures ?? null,
          };
        }),
    }))
    .sort((left, right) => right.trades.length - left.trades.length || left.strategyName.localeCompare(right.strategyName));
}

function buildRejectedSignalLearning(
  rejectedSignals: StrategyRejectedSignalAnalysis[],
  strategyById: Map<string, StrategyDefinition>,
) {
  const grouped = groupBy(rejectedSignals, (signal) => signal.strategyId);
  return Array.from(grouped.entries())
    .map(([strategyId, signals]) => ({
      strategyId,
      strategyName: strategyById.get(strategyId)?.name ?? strategyId,
      signals: signals
        .slice(0, 8)
        .sort((left, right) => right.rejectedAt.localeCompare(left.rejectedAt)),
    }))
    .sort((left, right) => right.signals.length - left.signals.length || left.strategyName.localeCompare(right.strategyName));
}

function confidenceFromSample(sampleSize: number, validationInput: StrategyValidationInput | undefined, scorecard: StrategyValidationScorecard | undefined) {
  const base = scorecard?.overallScore ?? 50;
  const sampleFactor = sampleSize >= 20 ? 20 : sampleSize >= 10 ? 14 : sampleSize >= 5 ? 8 : 4;
  const robustnessFactor = validationInput ? Math.max(0, 15 - validationInput.walkForward.degradationPct / 3) : 6;
  return round(clamp((base * 0.55) + sampleFactor + robustnessFactor));
}

function regimePerformanceFromValidation(validationInput: StrategyValidationInput | undefined, trades: ClosedPaperTrade[]) {
  if (validationInput) {
    const values = validationInput.regimePerformance;
    const trending = round(values.trending ?? values.trend ?? values["trend-following"] ?? 0);
    const ranging = round(values.ranging ?? values.range ?? values["mean_reversion"] ?? 0);
    const highVolatility = round(values.high_volatility ?? values.highVol ?? values["high-volatility"] ?? 0);
    const lowVolatility = round(values.low_volatility ?? values.lowVol ?? values["low-volatility"] ?? 0);
    const pairs: Array<[string, number]> = [
      ["trending", trending],
      ["ranging", ranging],
      ["high volatility", highVolatility],
      ["low volatility", lowVolatility],
    ];
    const allowedRegimes = pairs.filter(([, value]) => value >= 0).sort((left, right) => right[1] - left[1]).slice(0, 2).map(([label]) => label);
    return {
      trending,
      ranging,
      highVolatility,
      lowVolatility,
      allowedRegimes,
      recommendations: allowedRegimes.length > 0
        ? [`Prefer ${allowedRegimes[0]} conditions until further evidence expands.`]
        : ["Collect regime-labelled samples before changing regime use."],
    };
  }
  const stats = tradeMetrics(trades);
  return {
    trending: round(stats.expectancy * 100),
    ranging: round(stats.expectancy * 80),
    highVolatility: round(stats.volatility * 100),
    lowVolatility: round((1 - stats.volatility) * 100),
    allowedRegimes: stats.expectancy > 0 ? ["trending", "low volatility"] : ["monitor only"],
    recommendations: ["Use more regime-labelled evidence before expanding autonomy."],
  };
}

function symbolSuitabilityReport(validationInput: StrategyValidationInput | undefined, trades: ClosedPaperTrade[]) {
  const requestedSymbols = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD", "WTI", "Brent"];
  return requestedSymbols
    .map((symbol) => {
      const symbolTrades = trades.filter((trade) => trade.symbol === symbol);
      const groupedStats = tradeMetrics(symbolTrades);
      const expectancyFromValidation = validationInput?.symbolPerformance[symbol];
      return {
        symbol,
        expectancy: round(expectancyFromValidation ?? groupedStats.expectancy * 100),
        drawdown: round(groupedStats.maxDrawdown),
        winRate: round(groupedStats.winRate * 100),
        tradeCount: groupedStats.sampleSize,
        consistency: round(clamp(groupedStats.winRate * 100 - groupedStats.volatility * 15)),
        robustness: round(clamp((expectancyFromValidation ?? groupedStats.expectancy * 100) + groupedStats.sampleSize * 2)),
      };
    })
    .sort((left, right) => right.expectancy - left.expectancy || right.robustness - left.robustness);
}

function retirementVerdict(input: {
  lifecycle?: StrategyLifecycleReport;
  scorecard?: StrategyValidationScorecard;
  tradeStats: ReturnType<typeof tradeMetrics>;
  overfittingRisk: number;
  sampleDepth: StrategyEvidenceDepthReport;
  evidenceScore: number;
}) {
  const reasons: string[] = [];
  if (input.lifecycle?.recommendation === "retire") reasons.push("Lifecycle monitor already recommends retirement.");
  if (input.lifecycle?.recommendation === "pause") reasons.push("Lifecycle monitor recommends a pause for review.");
  if (input.scorecard?.verdict === "reject") reasons.push("Validation verdict is reject.");
  if (input.scorecard?.overallScore !== undefined && input.scorecard.overallScore < 45) reasons.push("Validation score is weak.");
  if (input.tradeStats.sampleSize >= 6 && input.tradeStats.recentExpectancy < 0 && input.tradeStats.expectancy <= 0) reasons.push("Recent and historical expectancy are both weak.");
  if (input.tradeStats.maxDrawdown > 2 && input.tradeStats.expectancy < 0) reasons.push("Drawdown is high relative to expectancy.");
  if (input.overfittingRisk > 70) reasons.push("Overfitting risk is elevated.");
  if (input.sampleDepth.verdict === "insufficient") reasons.push("Sample depth is still insufficient.");
  if (input.evidenceScore < 45) reasons.push("Evidence ranking score is weak.");
  const verdict: StrategyEvolutionReport["verdict"] = reasons.length >= 3 ? "retire" : reasons.length >= 2 ? "pause" : reasons.length >= 1 ? "watch" : "healthy";
  return { verdict, reasons };
}

function combineScoreEvolution(input: {
  baseScore: number;
  tradeStats: ReturnType<typeof tradeMetrics>;
  robustnessScore: number;
  overfittingRisk: number;
  lifecycle?: StrategyLifecycleReport;
  scorecard?: StrategyValidationScorecard;
  regimePerformance: ReturnType<typeof regimePerformanceFromValidation>;
  sampleDepth: StrategyEvidenceDepthReport;
  calibrationScore: number;
  riskAdjustedReturnScore: number;
  regretScore: number;
  regimeCoverageScore: number;
  symbolCoverageScore: number;
  behavioralPenalty: number;
}) {
  const regretPenalty = Math.min(18, Math.max(0, (1 - input.tradeStats.winRate) * 20) + input.overfittingRisk * 0.12 + (100 - input.regretScore) * 0.05);
  const behaviorPenalty = input.lifecycle?.decayDetected ? 8 : 0;
  const regimeBonus = input.regimePerformance.allowedRegimes.length > 0 ? 4 : 0;
  const evidenceBonus = input.sampleDepth.score * 0.14 + input.calibrationScore * 0.08 + input.riskAdjustedReturnScore * 0.1 + input.regimeCoverageScore * 0.04 + input.symbolCoverageScore * 0.04 - input.behavioralPenalty * 0.08;
  const score = clamp(input.baseScore * 0.32 + input.robustnessScore * 0.2 + (100 - regretPenalty - behaviorPenalty) * 0.18 + evidenceBonus + regimeBonus);
  const verdict: StrategyEvolutionReport["scoreEvolution"]["verdict"] = score >= 75 ? "healthy" : score >= 60 ? "watch" : score >= 45 ? "pause" : "retire";
  const reasons = [
    input.scorecard?.overfittingWarning ? "Validation shows overfitting risk." : null,
    input.lifecycle?.decayDetected ? "Lifecycle decay has been detected." : null,
    input.tradeStats.sampleSize >= 6 && input.tradeStats.recentExpectancy < input.tradeStats.expectancy ? "Recent expectancy is below the historical average." : null,
    input.sampleDepth.verdict === "insufficient" ? "Sample depth is still insufficient." : null,
  ].filter((item): item is string => Boolean(item));
  const adjustmentNotes = [
    regretPenalty > 8 ? "Reduce future confidence until regret patterns cool off." : "Score evolution is stable.",
    behaviorPenalty > 0 || input.behavioralPenalty > 0 ? "Behavioral penalties apply because decay or evidence drift is active." : "No behavioral penalty applied.",
  ];
  return {
    overallScore: round(score),
    confidence: round(clamp(input.robustnessScore - regretPenalty + regimeBonus + input.calibrationScore * 0.05)),
    verdict,
    reasons,
    adjustmentNotes,
  };
}

function decayVerdict(trades: ClosedPaperTrade[]) {
  const stats = tradeMetrics(trades);
  if (stats.sampleSize < 6) return "monitor";
  if (stats.recentWinRate + 0.18 < stats.winRate && stats.recentExpectancy < stats.expectancy - 0.1) return "retire";
  if (stats.recentWinRate + 0.12 < stats.winRate || stats.recentExpectancy + 0.08 < stats.expectancy || stats.recentDrawdown > stats.maxDrawdown + 0.5) return "pause";
  if (stats.volatility > 0.7) return "monitor";
  return "healthy";
}

function decayReasons(trades: ClosedPaperTrade[], verdict: PerformanceDecayItem["verdict"]) {
  const stats = tradeMetrics(trades);
  const reasons: string[] = [];
  if (stats.sampleSize < 6) reasons.push("Insufficient sample for a durable decay verdict.");
  if (stats.recentWinRate + 0.18 < stats.winRate) reasons.push("Rolling win rate is deteriorating.");
  if (stats.recentExpectancy < stats.expectancy - 0.1) reasons.push("Rolling expectancy is deteriorating.");
  if (stats.recentDrawdown > stats.maxDrawdown + 0.5) reasons.push("Recent drawdown is rising.");
  if (stats.volatility > 0.7) reasons.push("Trade volatility is elevated.");
  if (verdict === "retire") reasons.push("Decay is severe enough to warrant retirement review.");
  if (verdict === "pause") reasons.push("Decay is active enough to justify a pause review.");
  return reasons;
}

function rollingDeterioration(trades: ClosedPaperTrade[], metric: (window: ClosedPaperTrade[]) => number) {
  if (trades.length < 6) return 0;
  const size = Math.min(5, Math.floor(trades.length / 2));
  const recent = trades.slice(-size);
  const baseline = trades.slice(0, size);
  if (!baseline.length || !recent.length) return 0;
  return round(metric(baseline) - metric(recent));
}

function tradeMetrics(trades: ClosedPaperTrade[]) {
  if (!trades.length) {
    return {
      sampleSize: 0,
      expectancy: 0,
      winRate: 0,
      recentExpectancy: 0,
      recentWinRate: 0,
      recentDrawdown: 0,
      maxDrawdown: 0,
      volatility: 0,
      sharpe: 0,
    };
  }
  const normalizedReturns = normalizedTradeReturns(trades);
  const wins = normalizedReturns.filter((value) => value > 0).length;
  const expectancy = mean(normalizedReturns);
  const maxDrawdown = drawdown(normalizedReturns);
  const volatility = stddev(normalizedReturns);
  const sharpe = volatility === 0 ? 0 : expectancy / volatility;
  const recentWindow = normalizedReturns.slice(-Math.min(5, normalizedReturns.length));
  const baselineWindow = normalizedReturns.slice(0, Math.max(0, normalizedReturns.length - recentWindow.length));
  return {
    sampleSize: normalizedReturns.length,
    expectancy: round(expectancy),
    winRate: round(wins / normalizedReturns.length),
    recentExpectancy: round(mean(recentWindow)),
    recentWinRate: round(recentWindow.filter((value) => value > 0).length / recentWindow.length || 0),
    recentDrawdown: round(drawdown(recentWindow)),
    maxDrawdown: round(maxDrawdown),
    volatility: round(volatility),
    sharpe: round(sharpe),
    baselineExpectancy: round(mean(baselineWindow)),
  };
}

function normalizedTradeReturns(trades: ClosedPaperTrade[]) {
  return trades.map((trade) => trade.realizedPnL / Math.max(1, trade.riskTaken));
}

function isEarlyExit(trade: ClosedPaperTrade) {
  if (trade.realizedPnL <= 0) return false;
  const favorableExcursion = trade.side === "buy"
    ? trade.highestPrice - trade.entryPrice
    : trade.entryPrice - trade.lowestPrice;
  return favorableExcursion > Math.abs(trade.realizedPnL) * 1.35 && trade.exitReason !== "take_profit";
}

function isLateExit(trade: ClosedPaperTrade) {
  if (trade.realizedPnL >= 0) return false;
  const adverseExcursion = trade.side === "buy"
    ? trade.entryPrice - trade.lowestPrice
    : trade.highestPrice - trade.entryPrice;
  return adverseExcursion > Math.abs(trade.realizedPnL) * 1.35 && trade.exitReason === "manual";
}

function prettyPattern(pattern: RecurringMistakeItem["pattern"]) {
  switch (pattern) {
    case "overconfidence": return "Overconfidence";
    case "revenge_trading": return "Revenge trading";
    case "fomo": return "FOMO";
    case "oversized_positions": return "Oversized positions";
    case "stop_widening": return "Stop widening";
    case "strategy_switching": return "Strategy switching";
  }
}

function recurringItem(
  pattern: RecurringMistakeItem["pattern"],
  count: number,
  interventionRecommendation: string,
  textSources: string[],
  now: Date,
): RecurringMistakeItem {
  return {
    pattern,
    count,
    latestEvidence: textSources.find((source) => matchesPattern(pattern, source)) ?? "No direct evidence string captured.",
    interventionRecommendation,
    lessonPriority: clamp(30 + count * 18 + (pattern === "overconfidence" ? 12 : 0) + (pattern === "revenge_trading" ? 10 : 0)),
  };
}

function matchesPattern(pattern: RecurringMistakeItem["pattern"], value: string) {
  const normalized = value.toLowerCase();
  switch (pattern) {
    case "overconfidence": return /overconfident|confidence.*too high|high confidence/.test(normalized);
    case "revenge_trading": return /revenge/.test(normalized);
    case "fomo": return /\bfomo\b|fear of missing out|late entry|chased the move/.test(normalized);
    case "oversized_positions": return /oversized|position sizing|reduce_size|too large/.test(normalized);
    case "stop_widening": return /widen_stop|stop widen|moved stop|widened stop/.test(normalized);
    case "strategy_switching": return /strategy hopping|switching strategies|strategy switch/.test(normalized);
  }
}

function isNegativeOutcome(outcome: string) {
  return /wrong|failed|loss|invalid|opposite|miss/i.test(outcome);
}

function nodeId(kind: string, value: string) {
  return `${kind}-${slug(value)}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "item";
}

function groupBy<T, K>(items: T[], selector: (item: T) => K) {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = selector(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

function countMatches(values: string[], pattern: RegExp) {
  return values.reduce((sum, value) => sum + (pattern.test(value) ? 1 : 0), 0);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function drawdown(values: number[]) {
  let equity = 0;
  let peak = 0;
  let max = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    max = Math.max(max, peak - equity);
  }
  return max;
}

function sharpe(values: number[]) {
  const vol = stddev(values);
  return vol === 0 ? 0 : mean(values) / vol;
}

function expectancy(values: number[]) {
  return mean(values);
}

function winRate(values: number[]) {
  if (!values.length) return 0;
  return values.filter((value) => value > 0).length / values.length;
}

function maxDrawdown(values: number[]) {
  return drawdown(values);
}

function volatility(values: number[]) {
  return stddev(values);
}

function urgencyFor(priority: number): LearningPriorityItem["urgency"] {
  if (priority >= 90) return "critical";
  if (priority >= 75) return "high";
  if (priority >= 55) return "medium";
  return "low";
}

function recommendationList(items: Array<string | null | undefined>) {
  return items.filter((item): item is string => Boolean(item));
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const strategyLabService = new StrategyLabService();
