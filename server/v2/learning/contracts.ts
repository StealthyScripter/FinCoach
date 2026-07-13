export type LearningOutcome = "tp" | "sl" | "expired" | "cancelled" | "open" | "unknown";

export type LearningJournalEvidence = {
  journalEntryId: string;
  subjectId: string;
  outcome: LearningOutcome;
  r: number;
  tags: readonly string[];
  limitations: readonly string[];
  createdAt: string;
  lineageEventIds: readonly string[];
};

export type LearningAttribution = {
  primaryCause: string;
  supportingCauses: readonly string[];
  positiveSamples: number;
  negativeSamples: number;
  averageR: number;
};

export type LearningLesson = {
  lessonId: string;
  schemaVersion: "fincoach.v2.learning-lesson.1";
  topic: string;
  attribution: LearningAttribution;
  confidence: number;
  evidenceJournalEntryIds: readonly string[];
  limitations: readonly string[];
  createdAt: string;
  supersedesLessonId: string | null;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type LearningRequest = {
  topic: string;
  journalEntries: readonly LearningJournalEvidence[];
  minimumSamples: number;
  supersedesLessonId?: string | null;
  correlationId: string;
  causationId: string | null;
};

export type StrategyRevisionProposal = {
  proposalId: string;
  schemaVersion: "fincoach.v2.revision-proposal.1";
  lessonId: string;
  strategyId: string;
  boundedChange: Readonly<Record<string, unknown>>;
  rationale: string;
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type StrategyRevisionProposalInput = Omit<StrategyRevisionProposal, "schemaVersion" | "lessonId" | "createdAt" | "lineageEventIds" | "correlationId" | "causationId">;

export type LearningErrorCode =
  | "insufficient_evidence"
  | "contradictory_evidence"
  | "missing_lineage"
  | "invalid_numeric_evidence"
  | "missing_required_field";

export type LearningHealth = {
  module: "learning";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.learning-lesson.1";
  checkedAt: string;
  lessonCount: number;
  proposalCount: number;
};

export const learningModuleContract = {
  module: "learning",
  accepts: ["ResearchJournalEntryRecorded", "ResearchJournalEntrySuperseded"],
  emits: ["LessonCreated", "LessonRejected", "LessonSuperseded", "RevisionProposed", "LessonDuplicateSuppressed"],
  ownsTables: ["v2_learning_lessons", "v2_learning_revision_proposals"],
  publicContracts: ["LearningRequest", "LearningLesson", "StrategyRevisionProposal", "LearningHealth"],
  schemaVersion: "fincoach.v2.learning-lesson.1",
} as const;
