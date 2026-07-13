import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { LearningErrorCode, LearningHealth, LearningJournalEvidence, LearningLesson, LearningRequest, StrategyRevisionProposal, StrategyRevisionProposalInput } from "./contracts";
import { LearningV2EventTypes } from "./events";
import { InMemoryLearningRepository } from "./repository";

type LessonResult = { lesson: LearningLesson | null; events: DomainEvent[] };
type ProposalResult = { proposal: StrategyRevisionProposal | null; events: DomainEvent[] };

export class LearningV2Service {
  private readonly repository: InMemoryLearningRepository;

  constructor(repositoryOrSeed: InMemoryLearningRepository | ConstructorParameters<typeof InMemoryLearningRepository>[0] = new InMemoryLearningRepository()) {
    this.repository = repositoryOrSeed instanceof InMemoryLearningRepository ? repositoryOrSeed : new InMemoryLearningRepository(repositoryOrSeed);
  }

  generateLesson(request: LearningRequest): LessonResult {
    const rejected = validateRequest(request);
    if (rejected) return this.reject(request, rejected);
    const entries = [...request.journalEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.journalEntryId.localeCompare(b.journalEntryId));
    const attribution = attribute(entries);
    const lineageEventIds = [...new Set(entries.flatMap(entry => entry.lineageEventIds))].sort();
    const lessonId = createHash("sha256").update(JSON.stringify({ topic: request.topic, evidence: entries.map(entry => entry.journalEntryId) })).digest("hex").slice(0, 32);
    const confidence = clamp(Number((0.6 + Math.min(entries.length, 10) * 0.1).toFixed(2)));
    const lesson: LearningLesson = {
      lessonId,
      schemaVersion: "fincoach.v2.learning-lesson.1",
      topic: request.topic,
      attribution,
      confidence,
      evidenceJournalEntryIds: entries.map(entry => entry.journalEntryId),
      limitations: [...new Set(entries.flatMap(entry => entry.limitations))].sort(),
      createdAt: entries.at(-1)?.createdAt ?? new Date().toISOString(),
      supersedesLessonId: request.supersedesLessonId ?? null,
      lineageEventIds,
      correlationId: request.correlationId,
      causationId: request.causationId,
    };
    const saved = this.repository.saveLesson(lesson);
    const eventType = saved.inserted
      ? lesson.supersedesLessonId
        ? LearningV2EventTypes.LessonSuperseded
        : LearningV2EventTypes.LessonCreated
      : LearningV2EventTypes.LessonDuplicateSuppressed;
    return { lesson: saved.lesson, events: [createDomainEvent({ eventType, sourceModule: "learning", correlationId: request.correlationId, causationId: request.causationId, payload: { lessonId: saved.lesson.lessonId, topic: saved.lesson.topic } })] };
  }

  proposeRevision(lesson: LearningLesson, input: StrategyRevisionProposalInput): ProposalResult {
    if (!input.proposalId || !input.strategyId || !input.rationale || Object.keys(input.boundedChange).length === 0) {
      return { proposal: null, events: [createDomainEvent({ eventType: LearningV2EventTypes.LessonRejected, sourceModule: "learning", correlationId: lesson.correlationId, causationId: lesson.causationId, payload: { reason: "missing_required_field" } })] };
    }
    const proposal: StrategyRevisionProposal = {
      ...input,
      schemaVersion: "fincoach.v2.revision-proposal.1",
      lessonId: lesson.lessonId,
      createdAt: new Date(Date.parse(lesson.createdAt) + 1).toISOString(),
      lineageEventIds: [...lesson.lineageEventIds, lesson.lessonId],
      correlationId: lesson.correlationId,
      causationId: lesson.causationId,
    };
    const saved = this.repository.saveProposal(proposal);
    return { proposal: saved.proposal, events: [createDomainEvent({ eventType: LearningV2EventTypes.RevisionProposed, sourceModule: "learning", correlationId: lesson.correlationId, causationId: lesson.causationId, payload: { proposalId: saved.proposal.proposalId, lessonId: lesson.lessonId, inserted: saved.inserted } })] };
  }

  list() {
    return this.repository.listLessons();
  }

  repositorySnapshot() {
    return this.repository.snapshot();
  }

  health(checkedAt = new Date().toISOString()): LearningHealth {
    return { module: "learning", status: "healthy", schemaVersion: "fincoach.v2.learning-lesson.1", checkedAt, lessonCount: this.repository.listLessons().length, proposalCount: this.repository.listProposals().length };
  }

  private reject(request: LearningRequest, reason: LearningErrorCode): LessonResult {
    return { lesson: null, events: [createDomainEvent({ eventType: LearningV2EventTypes.LessonRejected, sourceModule: "learning", correlationId: request.correlationId, causationId: request.causationId, payload: { reason, topic: request.topic } })] };
  }
}

function validateRequest(request: LearningRequest): LearningErrorCode | null {
  if (!request.topic || !request.correlationId) return "missing_required_field";
  if (request.journalEntries.length < request.minimumSamples) return "insufficient_evidence";
  if (!request.journalEntries.every(entry => entry.lineageEventIds.length)) return "missing_lineage";
  if (!request.journalEntries.every(entry => Number.isFinite(entry.r))) return "invalid_numeric_evidence";
  const positives = request.journalEntries.filter(entry => entry.r > 0).length;
  const negatives = request.journalEntries.filter(entry => entry.r < 0).length;
  if (positives > 0 && negatives > 0 && positives === negatives) return "contradictory_evidence";
  return null;
}

function attribute(entries: readonly LearningJournalEvidence[]) {
  const tagScores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  entries.forEach((entry, entryIndex) => {
    entry.tags.forEach((tag, tagIndex) => {
      tagScores.set(tag, (tagScores.get(tag) ?? 0) + entry.r);
      if (!firstSeen.has(tag)) firstSeen.set(tag, entryIndex * 1000 + tagIndex);
    });
  });
  const ranked = [...tagScores.entries()].sort((a, b) => b[1] - a[1] || firstSeen.get(a[0])! - firstSeen.get(b[0])! || a[0].localeCompare(b[0]));
  const averageR = Number((entries.reduce((sum, entry) => sum + entry.r, 0) / entries.length).toFixed(4));
  return { primaryCause: ranked[0]?.[0] ?? "unattributed", supportingCauses: ranked.slice(1).map(([tag]) => tag), positiveSamples: entries.filter(entry => entry.r > 0).length, negativeSamples: entries.filter(entry => entry.r < 0).length, averageR };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export const learningV2Service = new LearningV2Service();
