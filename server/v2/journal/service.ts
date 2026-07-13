import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ResearchJournalEntry, ResearchJournalEntryInput, ResearchJournalErrorCode, ResearchJournalHealth } from "./contracts";
import { ResearchJournalV2EventTypes } from "./events";
import { InMemoryResearchJournalRepository } from "./repository";

type JournalResult = { entry: ResearchJournalEntry | null; events: DomainEvent[] };

export class ResearchJournalV2Service {
  private readonly repository: InMemoryResearchJournalRepository;

  constructor(repositoryOrSeed: InMemoryResearchJournalRepository | readonly ResearchJournalEntry[] = new InMemoryResearchJournalRepository()) {
    this.repository = repositoryOrSeed instanceof InMemoryResearchJournalRepository
      ? repositoryOrSeed
      : new InMemoryResearchJournalRepository(repositoryOrSeed);
  }

  record(input: ResearchJournalEntryInput): JournalResult {
    return this.append(input, false);
  }

  recordCorrection(input: ResearchJournalEntryInput): JournalResult {
    return this.append(input, true);
  }

  get(id: string) {
    return this.repository.get(id);
  }

  list() {
    return this.repository.list();
  }

  repositorySnapshot() {
    return this.repository.snapshot();
  }

  health(checkedAt = new Date().toISOString()): ResearchJournalHealth {
    const entries = this.repository.list();
    return {
      module: "journal",
      status: "healthy",
      schemaVersion: "fincoach.v2.research-journal.1",
      checkedAt,
      entryCount: entries.length,
      latestEntryId: entries.at(-1)?.journalEntryId ?? null,
    };
  }

  private append(input: ResearchJournalEntryInput, correction: boolean): JournalResult {
    const rejected = validate(input, correction, this.repository);
    if (rejected) {
      return {
        entry: null,
        events: [
          createDomainEvent({
            eventType: ResearchJournalV2EventTypes.ResearchJournalEntryRejected,
            sourceModule: "journal",
            correlationId: input.correlationId,
            causationId: input.causationId,
            payload: { reason: rejected, journalEntryId: input.journalEntryId, subjectId: input.subjectId },
          }),
        ],
      };
    }
    const entry: ResearchJournalEntry = {
      ...input,
      schemaVersion: "fincoach.v2.research-journal.1",
      immutable: true,
    };
    const saved = this.repository.append(entry);
    const eventType = saved.inserted
      ? correction
        ? ResearchJournalV2EventTypes.ResearchJournalEntrySuperseded
        : ResearchJournalV2EventTypes.ResearchJournalEntryRecorded
      : ResearchJournalV2EventTypes.ResearchJournalDuplicateSuppressed;
    return {
      entry: saved.entry,
      events: [
        createDomainEvent({
          eventType,
          sourceModule: "journal",
          correlationId: input.correlationId,
          causationId: input.causationId,
          payload: {
            journalEntryId: saved.entry.journalEntryId,
            subjectType: saved.entry.subjectType,
            subjectId: saved.entry.subjectId,
            supersedesEntryId: saved.entry.supersedesEntryId,
          },
        }),
      ],
    };
  }
}

function validate(
  input: ResearchJournalEntryInput,
  correction: boolean,
  repository: InMemoryResearchJournalRepository,
): ResearchJournalErrorCode | null {
  if (!input.journalEntryId || !input.subjectId || !input.summary || !input.conclusion || !input.correlationId) return "missing_required_field";
  if (!input.lineageEventIds.length) return "missing_lineage";
  if (Number.isNaN(Date.parse(input.createdAt))) return "invalid_timestamp";
  if (Object.keys(input.evidence).length === 0) return "empty_evidence";
  if (input.supersedesEntryId === input.journalEntryId) return "self_supersession";
  if (correction && (!input.supersedesEntryId || !repository.has(input.supersedesEntryId))) return "unknown_superseded_entry";
  return null;
}

export const researchJournalV2Service = new ResearchJournalV2Service();
