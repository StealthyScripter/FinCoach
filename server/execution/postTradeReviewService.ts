import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { predictionReviewService, type PredictionReviewService } from "../predictionReviewService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import type { ClosedPaperTrade } from "./paperStrategyRuntime";
import { strategyAdaptationService, type StrategyAdaptationService } from "./strategyAdaptationService";
import { marketDataMetrics, type MarketDataMetrics } from "./marketDataMetrics";
import { strategyEvidenceStore } from "./strategyEvidenceStore";
import { publishTelegramLifecycleAlert } from "../telegramNotificationBus";

export type PostTradeReview = {
  id: string;
  tradeId: string;
  strategyId: string;
  symbol: string;
  originalThesis: string;
  entryReason: string;
  exitReason: string;
  expectedMove: string;
  actualMove: number;
  riskTaken: number;
  result: "win" | "loss" | "breakeven";
  whatWorked: string[];
  whatFailed: string[];
  missedEvidence: string[];
  updatedLesson: string;
  strategyImprovementNote: string;
  predictionReviewId: string;
  proficiencyGraphUpdates: string[];
  strategyValidationScoreDelta: number;
  adaptationSuggestionIds: string[];
  reviewedAt: string;
};

export type ReviewableClosedTrade = ClosedPaperTrade & {
  source?: "paper" | "sandbox";
};

export class PostTradeReviewService {
  private reviews: PostTradeReview[] = [];
  private strategyScoreAdjustments = new Map<string, number>();
  private proficiencyUpdates: string[] = [];

  constructor(
    private readonly predictions: PredictionReviewService = predictionReviewService,
    private readonly adaptations: StrategyAdaptationService = strategyAdaptationService,
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: MarketDataMetrics = marketDataMetrics,
  ) {}

  reviewPaperTrade(trade: ClosedPaperTrade, missedEvidence: string[] = [], now = new Date()) {
    return this.reviewClosedTrade({ ...trade, source: "paper" }, missedEvidence, now);
  }

  reviewSandboxTrade(trade: ReviewableClosedTrade, missedEvidence: string[] = [], now = new Date()) {
    return this.reviewClosedTrade({ ...trade, source: "sandbox" }, missedEvidence, now);
  }

  private reviewClosedTrade(trade: ReviewableClosedTrade, missedEvidence: string[], now: Date) {
    const result = trade.realizedPnL > 0 ? "win" : trade.realizedPnL < 0 ? "loss" : "breakeven";
    const prediction = this.predictions.record({
      originalThesis: trade.thesis,
      confidence: result === "win" ? 75 : 55,
      evidenceUsed: [trade.entryReason],
      missingEvidence: missedEvidence,
      expectedOutcome: trade.expectedMove,
      actualOutcome: null,
      timeHorizon: `${trade.openedAt} to ${trade.closedAt}`,
      agent: "risk",
      strategyDowngraded: false,
    }, now);
    const predictionReview = this.predictions.review({
      predictionId: prediction.id,
      actualOutcome: `${trade.exitReason}; realized P/L ${trade.realizedPnL}; move ${trade.actualMove}`,
      missingEvidence: missedEvidence,
      agent: "risk",
    }, now);
    const suggestions = this.adaptations.generate({
      strategyId: trade.strategyId,
      result,
      exitReason: trade.exitReason,
      missedEvidence,
      riskTaken: trade.riskTaken,
      realizedPnL: trade.realizedPnL,
      symbol: trade.symbol,
    });
    const review: PostTradeReview = {
      id: randomUUID(),
      tradeId: trade.id,
      strategyId: trade.strategyId,
      symbol: trade.symbol,
      originalThesis: trade.thesis,
      entryReason: trade.entryReason,
      exitReason: trade.exitReason,
      expectedMove: trade.expectedMove,
      actualMove: trade.actualMove,
      riskTaken: trade.riskTaken,
      result,
      whatWorked: result === "win"
        ? ["The position followed the expected direction.", `${trade.exitReason} protected or realized the move.`]
        : ["The configured exit limited the loss.", "The trade produced measurable feedback."],
      whatFailed: result === "loss"
        ? ["The expected move did not materialize before the risk exit.", "Entry evidence or timing needs review."]
        : [],
      missedEvidence: [...missedEvidence],
      updatedLesson: predictionReview.updatedLesson,
      strategyImprovementNote: predictionReview.futureRuleAdjustment,
      predictionReviewId: predictionReview.id,
      proficiencyGraphUpdates: predictionReview.feeds.proficiencyGraph,
      strategyValidationScoreDelta: result === "win" ? 1 : result === "loss" ? -2 : 0,
      adaptationSuggestionIds: suggestions.map((suggestion) => suggestion.id),
      reviewedAt: now.toISOString(),
    };
    this.reviews.unshift(review);
    this.strategyScoreAdjustments.set(
      trade.strategyId,
      (this.strategyScoreAdjustments.get(trade.strategyId) ?? 0) + review.strategyValidationScoreDelta,
    );
    this.proficiencyUpdates.unshift(...review.proficiencyGraphUpdates);
    this.metrics.recordReview();
    strategyEvidenceStore.recordPostTradeReview({
      strategyId: trade.strategyId,
      symbol: trade.symbol,
      summary: `${review.result} review for ${trade.symbol}: ${review.updatedLesson}`,
      outcome: result,
      verdict: result === "win" ? "healthy" : result === "loss" ? "watch" : "accept",
      timestamp: now.toISOString(),
      regime: (trade as ClosedPaperTrade & { evidenceContext?: { marketRegime?: string } }).evidenceContext?.marketRegime ?? null,
      metadata: {
        tradeId: trade.id,
        predictionReviewId: predictionReview.id,
        missedEvidence,
        strategyValidationScoreDelta: review.strategyValidationScoreDelta,
        adaptationSuggestionIds: review.adaptationSuggestionIds,
      },
    });
    this.events.append({
      type: "post_trade.review_completed",
      userId: "system",
      sourceService: "post-trade-review",
      correlationId: review.id,
      payload: {
        tradeId: trade.id,
        strategyId: trade.strategyId,
        source: trade.source ?? "paper",
        result,
        predictionReviewId: predictionReview.id,
        proficiencyGraphUpdates: review.proficiencyGraphUpdates,
        strategyValidationScoreDelta: review.strategyValidationScoreDelta,
      },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "post_trade.review",
      outcome: "created",
      correlationId: review.id,
      detail: { tradeId: trade.id, strategyId: trade.strategyId, result, suggestionCount: suggestions.length },
    });
    void publishTelegramLifecycleAlert({
      id: `post-trade-review-${review.id}`,
      source: "review",
      eventType: "post.trade.review_ready",
      severity: "info",
      title: "Post-trade review ready",
      message: `${trade.strategyId} ${trade.symbol} review is ready: ${review.updatedLesson}`,
      requiredActions: ["Open the Journal", "Review adaptation suggestions"],
      createdAt: now.toISOString(),
    });
    return clone(review);
  }

  list() {
    return this.reviews.map(clone);
  }

  learningSnapshot() {
    return {
      journal: this.list(),
      predictionReviews: this.predictions.listReviews(),
      proficiencyGraphUpdates: [...this.proficiencyUpdates],
      strategyValidationScoreAdjustments: Object.fromEntries(this.strategyScoreAdjustments),
      adaptationSuggestions: this.adaptations.list(),
    };
  }
}

function clone(review: PostTradeReview): PostTradeReview {
  return {
    ...review,
    whatWorked: [...review.whatWorked],
    whatFailed: [...review.whatFailed],
    missedEvidence: [...review.missedEvidence],
    proficiencyGraphUpdates: [...review.proficiencyGraphUpdates],
    adaptationSuggestionIds: [...review.adaptationSuggestionIds],
  };
}

export const postTradeReviewService = new PostTradeReviewService();
