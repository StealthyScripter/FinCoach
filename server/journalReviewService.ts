import { randomUUID } from "crypto";
import type {
  JournalEntry,
  JournalReview,
  JournalReviewResult,
  JournalReviewSubmission,
  ProficiencyScore,
  Progression,
} from "@shared/schema";
import { deriveProgression } from "./proficiencyAssessmentService";

const category = "trading_psychology" as const;

export class JournalReviewService {
  review({
    submission,
    journalEntry,
    scores,
    progression,
    now = new Date(),
  }: {
    submission: JournalReviewSubmission;
    journalEntry: JournalEntry;
    scores: ProficiencyScore[];
    progression: Progression;
    now?: Date;
  }): JournalReviewResult {
    const current = scores.find((score) => score.category === category) ?? {
      id: "prof-trading-psychology",
      category,
      label: "Trading Psychology",
      score: 45,
      unlocks: [],
      evidence: [],
      updatedAt: now.toISOString(),
    };
    const qualityScore = scoreReflection(submission);
    const proficiencyDelta = qualityScore >= 80 ? 8 : qualityScore >= 65 ? 4 : qualityScore >= 50 ? 1 : -3;
    const mistakePatterns = [
      submission.followedPlan ? null : "Deviated from written plan",
      submission.respectedStop ? null : "Ignored or moved stop/exit logic",
      submission.positionSizingDiscipline < 60 ? "Weak position sizing discipline" : null,
      ["impulsive", "revenge", "overconfident"].includes(submission.emotionalState)
        ? `${submission.emotionalState} emotional state`
        : null,
    ].filter((item): item is string => Boolean(item));
    const disciplineSignals = [
      submission.followedPlan ? "Followed written plan" : null,
      submission.respectedStop ? "Respected stop or invalidation condition" : null,
      submission.positionSizingDiscipline >= 75 ? "Position size matched risk plan" : null,
      submission.emotionalState === "calm" ? "Calm execution state" : null,
    ].filter((item): item is string => Boolean(item));
    const review: JournalReview = {
      id: randomUUID(),
      journalEntryId: journalEntry.id,
      qualityScore,
      mistakePatterns,
      disciplineSignals,
      feedback: buildFeedback(qualityScore, mistakePatterns),
      proficiencyCategory: category,
      proficiencyDelta,
      createdAt: now.toISOString(),
    };
    const updatedScore: ProficiencyScore = {
      ...current,
      score: clamp(current.score + proficiencyDelta),
      unlocks: Array.from(new Set([
        ...current.unlocks,
        ...(qualityScore >= 80 ? ["Journal quality gate"] : []),
      ])),
      evidence: [
        `Journal review ${journalEntry.title}: ${qualityScore}/100`,
        ...disciplineSignals,
        ...current.evidence,
      ].slice(0, 8),
      updatedAt: now.toISOString(),
    };
    const updatedJournalEntry: JournalEntry = {
      ...journalEntry,
      qualityScore,
      notes: `${journalEntry.notes}\n\nReview: ${submission.reflection}`,
      lessons: Array.from(new Set([...submission.lessonsLearned, ...journalEntry.lessons])).slice(0, 8),
    };
    const nextScores = scores.some((score) => score.category === category)
      ? scores.map((score) => score.category === category ? updatedScore : score)
      : [...scores, updatedScore];

    return {
      review,
      journalEntry: updatedJournalEntry,
      updatedScore,
      previousScore: current.score,
      progression: deriveProgression(nextScores, progression),
      remediation: mistakePatterns.length > 0
        ? [
            "Write the pre-trade plan before the next ticket.",
            "Reduce size until stop discipline and emotional state are consistent.",
          ]
        : [],
      unlocked: qualityScore >= 80 ? ["Journal quality gate"] : [],
    };
  }
}

export const journalReviewService = new JournalReviewService();

function scoreReflection(submission: JournalReviewSubmission) {
  let score = 35;
  score += submission.followedPlan ? 18 : -8;
  score += submission.respectedStop ? 18 : -12;
  score += Math.round(submission.positionSizingDiscipline * 0.22);
  score += submission.reflection.length >= 160 ? 8 : submission.reflection.length >= 80 ? 4 : 0;
  score += submission.lessonsLearned.length >= 2 ? 5 : 2;
  score += submission.emotionalState === "calm" ? 8 : submission.emotionalState === "anxious" ? 2 : -8;
  return clamp(score);
}

function buildFeedback(qualityScore: number, mistakePatterns: string[]) {
  if (qualityScore >= 80) return ["Strong journal: plan, risk discipline, emotional state, and lessons are clearly documented."];
  if (qualityScore >= 65) return ["Usable journal: add more detail about invalidation and what would change next time."];
  return [
    "Journal does not yet prove consistent risk discipline.",
    ...mistakePatterns.slice(0, 2),
  ];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
