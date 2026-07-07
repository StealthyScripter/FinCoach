import { randomUUID } from "crypto";
import type { PredictionRecord, PredictionReview, PredictionReviewSubmission } from "@shared/schema";
import { agentMemoryService } from "./memoryService";

export type PredictionInsightTheme = {
  theme: string;
  count: number;
  latestPredictionId: string;
  latestReviewId: string;
  latestUpdatedLesson: string;
  latestFutureRuleAdjustment: string;
  exampleMissingEvidence: string[];
};

export type PredictionInsightReport = {
  generatedAt: string;
  reviewCount: number;
  topThemes: PredictionInsightTheme[];
  recentRules: Array<{
    predictionId: string;
    reviewedAt: string;
    whatWasMissed: string;
    updatedLesson: string;
    futureRuleAdjustment: string;
  }>;
};

export class PredictionReviewService {
  private readonly predictions = new Map<string, PredictionRecord>();
  private readonly reviews: PredictionReview[] = [];

  record(input: Omit<PredictionRecord, "id" | "createdAt">, now = new Date()): PredictionRecord {
    const record: PredictionRecord = {
      ...input,
      id: `prediction-${randomUUID()}`,
      createdAt: now.toISOString(),
    };
    this.predictions.set(record.id, record);
    return record;
  }

  review(submission: PredictionReviewSubmission, now = new Date()): PredictionReview {
    const record = this.predictions.get(submission.predictionId) ?? this.fallbackRecord(submission, now);
    const missingEvidence = Array.from(new Set([...record.missingEvidence, ...submission.missingEvidence]));
    const contradicted = /wrong|failed|miss|opposite|loss|invalid/i.test(submission.actualOutcome);
    const updatedLesson = contradicted
      ? "Do not upgrade a thesis until contradictory evidence and missing catalysts have been checked."
      : "Keep tracking the evidence chain and compare expected versus actual outcomes.";
    const futureRuleAdjustment = contradicted
      ? "Downgrade future confidence when source freshness, contradictory evidence, or catalyst coverage is incomplete."
      : "Maintain current strategy rating but continue monitoring calibration.";
    const review: PredictionReview = {
      id: `review-${randomUUID()}`,
      predictionId: record.id,
      originalThesis: record.originalThesis,
      confidence: record.confidence,
      evidenceUsed: record.evidenceUsed,
      missingEvidence,
      expectedOutcome: record.expectedOutcome,
      actualOutcome: submission.actualOutcome,
      timeHorizon: record.timeHorizon,
      whatWasWrong: contradicted
        ? ["The expected outcome did not match the actual outcome.", "Confidence should be reduced for similar evidence quality."]
        : ["Outcome was not clearly wrong, but confidence calibration still needs review."],
      whatWasMissed: missingEvidence.length > 0
        ? missingEvidence
        : ["No explicit missing evidence was supplied; require a stronger post-mortem before changing rules."],
      whichAgentFailed: submission.agent ?? record.agent,
      updatedLesson: normalizeInsightText(updatedLesson),
      futureRuleAdjustment: normalizeInsightText(futureRuleAdjustment),
      shouldConfidenceModelChange: contradicted || record.confidence > 80,
      shouldStrategyBeDowngraded: contradicted || record.strategyDowngraded,
      userLearning: "Separate what happened from why it happened, and define what would prove the thesis wrong before acting.",
      feeds: {
        knowledgeGraph: ["Add miss as a LessonLearned node linked to the original thesis."],
        proficiencyGraph: ["Increase emphasis on verification, risk management, and market causality lessons."],
        behavioralIntelligence: ["Flag overconfidence if user acted before confirmation."],
        agentEvaluation: [`Review ${submission.agent ?? record.agent} agent evidence quality.`],
        researchQualityScores: ["Reduce score when missing evidence was knowable before the prediction."],
      },
      reviewedAt: now.toISOString(),
    };
    this.predictions.set(record.id, { ...record, actualOutcome: submission.actualOutcome, missingEvidence });
    this.reviews.unshift(review);
    this.remember(review);
    return review;
  }

  listReviews(): PredictionReview[] {
    return this.reviews;
  }

  listPredictions(): PredictionRecord[] {
    return Array.from(this.predictions.values());
  }

  clearForTest() {
    this.predictions.clear();
    this.reviews.length = 0;
  }

  insights(limit = 3, now = new Date()): PredictionInsightReport {
    const reviews = [...this.reviews];
    const grouped = new Map<string, PredictionReview[]>();

    for (const review of reviews) {
      const theme = review.updatedLesson;
      const bucket = grouped.get(theme) ?? [];
      bucket.push(review);
      grouped.set(theme, bucket);
    }

    const topThemes = Array.from(grouped.entries())
      .map(([theme, themeReviews]) => {
        const latest = themeReviews.sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))[0];
        return {
          theme,
          count: themeReviews.length,
          latestPredictionId: latest.predictionId,
          latestReviewId: latest.id,
          latestUpdatedLesson: latest.updatedLesson,
          latestFutureRuleAdjustment: latest.futureRuleAdjustment,
          exampleMissingEvidence: latest.whatWasMissed.slice(0, 3),
        };
      })
      .sort((left, right) => right.count - left.count || right.latestReviewId.localeCompare(left.latestReviewId))
      .slice(0, limit);

    return {
      generatedAt: now.toISOString(),
      reviewCount: reviews.length,
      topThemes,
      recentRules: reviews.slice(0, limit).map((review) => ({
        predictionId: review.predictionId,
        reviewedAt: review.reviewedAt,
        whatWasMissed: review.whatWasMissed[0] ?? "No missed evidence recorded.",
        updatedLesson: review.updatedLesson,
        futureRuleAdjustment: review.futureRuleAdjustment,
      })),
    };
  }

  private fallbackRecord(submission: PredictionReviewSubmission, now: Date): PredictionRecord {
    const record: PredictionRecord = {
      id: submission.predictionId,
      originalThesis: "Externally supplied prediction for review.",
      confidence: 50,
      evidenceUsed: [],
      missingEvidence: submission.missingEvidence,
      expectedOutcome: "Outcome was not recorded before review.",
      actualOutcome: null,
      timeHorizon: "unknown",
      agent: submission.agent ?? "verification",
      strategyDowngraded: false,
      createdAt: now.toISOString(),
    };
    this.predictions.set(record.id, record);
    return record;
  }

  private remember(review: PredictionReview) {
    const reviewSummary = [
      `Prediction ${review.predictionId}: ${review.originalThesis}`,
      `Actual outcome: ${review.actualOutcome}`,
      `Updated lesson: ${review.updatedLesson}`,
      `Future rule: ${review.futureRuleAdjustment}`,
    ].join(" ");

    agentMemoryService.longTerm.store({
      kind: "agent_decision",
      text: reviewSummary,
      tags: ["prediction_review", review.predictionId, review.whichAgentFailed],
      metadata: {
        predictionId: review.predictionId,
        confidence: review.confidence,
        shouldDowngrade: review.shouldStrategyBeDowngraded,
        graphNodeId: `prediction-review-${review.predictionId}`,
      },
    });

    agentMemoryService.semantic.store({
      kind: "lesson_learned",
      text: `${review.updatedLesson} ${review.futureRuleAdjustment}`,
      tags: ["prediction_review", review.predictionId, "lesson"],
      metadata: {
        predictionId: review.predictionId,
        whatWasWrong: review.whatWasWrong,
        whatWasMissed: review.whatWasMissed,
        graphNodeId: `prediction-review-${review.predictionId}`,
      },
    });
  }
}

export const predictionReviewService = new PredictionReviewService();

function normalizeInsightText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Maintain current strategy rating but continue monitoring calibration.";
}
