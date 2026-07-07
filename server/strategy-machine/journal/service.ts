import { randomUUID } from "crypto";
import { createEvent, type EventReference } from "../core";
import { JournalEventTypes } from "./events";
import type { ScreenshotReference, TradeJournal } from "./contracts";
import { TradeJournalRepository } from "./repository";

export class TradeJournalService {
  constructor(private readonly repository = new TradeJournalRepository()) {}

  create(input: Omit<TradeJournal, "journalId" | "lessonLearned" | "mistakeClassification" | "improvementSuggestion">) {
    validateRequired(input);
    const journal: TradeJournal = {
      ...input,
      journalId: randomUUID(),
      lessonLearned: null,
      mistakeClassification: null,
      improvementSuggestion: null,
    };
    this.repository.save(journal);
    return createEvent({ type: JournalEventTypes.TradeJournalCreated, module: "journal", payload: journal as unknown as Record<string, unknown>, sourceEventRefs: journal.sourceEventRefs });
  }

  attachSnapshot(journalId: string, refs: { before?: EventReference[]; after?: EventReference[]; multiTimeframe?: EventReference[]; screenshots?: ScreenshotReference[] }) {
    const journal = this.require(journalId);
    journal.beforeEntrySnapshotRefs.push(...(refs.before ?? []));
    journal.afterExitSnapshotRefs.push(...(refs.after ?? []));
    journal.multiTimeframeSnapshotRefs.push(...(refs.multiTimeframe ?? []));
    journal.screenshotRefs.push(...(refs.screenshots ?? []));
    this.repository.save(journal);
    return createEvent({ type: JournalEventTypes.TradeSnapshotAttached, module: "journal", payload: journal as unknown as Record<string, unknown>, sourceEventRefs: [...(refs.before ?? []), ...(refs.after ?? []), ...(refs.multiTimeframe ?? [])] });
  }

  review(journalId: string, review: { lessonLearned: string; mistakeClassification: string | null; improvementSuggestion: string | null; refs: EventReference[] }) {
    const journal = this.require(journalId);
    journal.lessonLearned = review.lessonLearned;
    journal.mistakeClassification = review.mistakeClassification;
    journal.improvementSuggestion = review.improvementSuggestion;
    this.repository.save(journal);
    const reviewed = createEvent({ type: JournalEventTypes.TradeReviewed, module: "journal", payload: journal as unknown as Record<string, unknown>, sourceEventRefs: review.refs });
    return [
      reviewed,
      createEvent({ type: JournalEventTypes.LessonExtracted, module: "journal", payload: { journalId, lesson: review.lessonLearned }, causationId: reviewed.id, sourceEventRefs: [referenceFrom(reviewed)] }),
      ...(review.improvementSuggestion ? [createEvent({ type: JournalEventTypes.RuleImprovementSuggested, module: "journal", payload: { journalId, suggestion: review.improvementSuggestion }, causationId: reviewed.id, sourceEventRefs: [referenceFrom(reviewed)] })] : []),
    ];
  }

  search(input: Parameters<TradeJournalRepository["search"]>[0]) {
    return this.repository.search(input);
  }

  private require(journalId: string) {
    const journal = this.repository.get(journalId);
    if (!journal) throw new Error(`Trade journal not found: ${journalId}`);
    return journal;
  }
}

function validateRequired(input: Omit<TradeJournal, "journalId" | "lessonLearned" | "mistakeClassification" | "improvementSuggestion">) {
  if (!input.entryReason || input.stopLoss <= 0 || input.takeProfit <= 0 || input.positionSize <= 0) throw new Error("Trade journal required fields are incomplete");
}

function referenceFrom(event: { id: string; type: string; module: EventReference["module"]; schemaVersion: string; occurredAt: string }): EventReference {
  return { eventId: event.id, eventType: event.type, module: event.module, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt };
}

export const tradeJournalService = new TradeJournalService();
