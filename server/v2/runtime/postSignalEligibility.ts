import type { V2ResearchSignal } from "../signals";
import type { ExternalEvaluation } from "../external-evaluation";
import type { ResearchJournalEntry } from "../journal";
import type { LearningLesson } from "../learning";

export type TransitionEligibilityReason =
  | "eligible"
  | "evaluation_horizon_incomplete"
  | "missing_lineage"
  | "unknown_or_open_evaluation"
  | "ineligible_evaluation_outcome"
  | "journal_subject_ineligible"
  | "journal_outcome_missing"
  | "lesson_missing_evidence"
  | "lesson_unknown_outcome";

export type TransitionEligibility = { eligible: boolean; reason: TransitionEligibilityReason };

export function evaluateSignalForEvaluationEligibility(signal: V2ResearchSignal, now: Date): TransitionEligibility {
  if (!signal.demoOnly || !signal.lineageEventIds.length) return { eligible: false, reason: "missing_lineage" };
  if (Date.parse(signal.validUntil) > now.getTime()) return { eligible: false, reason: "evaluation_horizon_incomplete" };
  return { eligible: true, reason: "eligible" };
}

export function evaluateEvaluationForJournalEligibility(evaluation: ExternalEvaluation): TransitionEligibility {
  if (!evaluation.lineageEventIds.length) return { eligible: false, reason: "missing_lineage" };
  if (evaluation.outcome === "open" || evaluation.outcome === "unknown") return { eligible: false, reason: "unknown_or_open_evaluation" };
  if (!["tp", "sl", "expired", "cancelled"].includes(evaluation.outcome)) return { eligible: false, reason: "ineligible_evaluation_outcome" };
  return { eligible: true, reason: "eligible" };
}

export function evaluateJournalForLessonEligibility(entry: ResearchJournalEntry): TransitionEligibility {
  if (!entry.lineageEventIds.length) return { eligible: false, reason: "missing_lineage" };
  if (entry.subjectType !== "external_evaluation") return { eligible: false, reason: "journal_subject_ineligible" };
  const outcome = (entry.evidence as { outcome?: unknown }).outcome;
  if (!["tp", "sl", "expired", "cancelled"].includes(String(outcome))) return { eligible: false, reason: "journal_outcome_missing" };
  return { eligible: true, reason: "eligible" };
}

export function evaluateLessonForLifecycleEligibility(lesson: LearningLesson): TransitionEligibility {
  if (!lesson.lineageEventIds.length) return { eligible: false, reason: "missing_lineage" };
  if (!lesson.evidenceJournalEntryIds.length) return { eligible: false, reason: "lesson_missing_evidence" };
  if (!Number.isFinite(lesson.attribution.averageR)) return { eligible: false, reason: "lesson_unknown_outcome" };
  return { eligible: true, reason: "eligible" };
}
