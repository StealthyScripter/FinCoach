import type { V2ModuleName } from "../contracts";

export type ResearchJournalSubjectType =
  | "forward_test"
  | "signal"
  | "external_evaluation"
  | "reconciliation"
  | "portfolio_review";

export type ResearchJournalEntry = {
  journalEntryId: string;
  schemaVersion: "fincoach.v2.research-journal.1";
  subjectType: ResearchJournalSubjectType;
  subjectId: string;
  sourceModule: V2ModuleName;
  summary: string;
  evidence: Readonly<Record<string, unknown>>;
  conclusion: string;
  limitations: readonly string[];
  supersedesEntryId: string | null;
  immutable: true;
  createdAt: string;
  lineageEventIds: readonly string[];
  correlationId: string;
  causationId: string | null;
};

export type ResearchJournalEntryInput = Omit<ResearchJournalEntry, "schemaVersion" | "immutable">;

export type ResearchJournalErrorCode =
  | "missing_required_field"
  | "missing_lineage"
  | "invalid_timestamp"
  | "empty_evidence"
  | "unknown_superseded_entry"
  | "self_supersession";

export type ResearchJournalHealth = {
  module: "journal";
  status: "healthy" | "degraded";
  schemaVersion: "fincoach.v2.research-journal.1";
  checkedAt: string;
  entryCount: number;
  latestEntryId: string | null;
};

export const researchJournalModuleContract = {
  module: "journal",
  accepts: [
    "ForwardTestCreated",
    "SignalPublished",
    "ExternalEvaluationReceived",
    "SignalOutcomeReconciled",
    "EvaluationDisagreementDetected",
  ],
  emits: [
    "ResearchJournalEntryRecorded",
    "ResearchJournalEntryRejected",
    "ResearchJournalEntrySuperseded",
    "ResearchJournalDuplicateSuppressed",
  ],
  ownsTables: ["v2_research_journal_entries"],
  publicContracts: ["ResearchJournalEntryInput", "ResearchJournalEntry", "ResearchJournalHealth"],
  schemaVersion: "fincoach.v2.research-journal.1",
} as const;
