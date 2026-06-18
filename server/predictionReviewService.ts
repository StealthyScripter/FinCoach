import { randomUUID } from "crypto";
import type { PredictionRecord, PredictionReview, PredictionReviewSubmission } from "@shared/schema";

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
      updatedLesson: contradicted
        ? "Do not upgrade a thesis until contradictory evidence and missing catalysts have been checked."
        : "Keep tracking the evidence chain and compare expected versus actual outcomes.",
      futureRuleAdjustment: contradicted
        ? "Downgrade future confidence when source freshness, contradictory evidence, or catalyst coverage is incomplete."
        : "Maintain current strategy rating but continue monitoring calibration.",
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
    return review;
  }

  listReviews(): PredictionReview[] {
    return this.reviews;
  }

  listPredictions(): PredictionRecord[] {
    return Array.from(this.predictions.values());
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
}

export const predictionReviewService = new PredictionReviewService();
