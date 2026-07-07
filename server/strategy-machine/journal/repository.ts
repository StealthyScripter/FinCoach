import type { TradeJournal } from "./contracts";

export class TradeJournalRepository {
  private readonly journals = new Map<string, TradeJournal>();

  save(journal: TradeJournal) {
    this.journals.set(journal.journalId, clone(journal));
    return journal;
  }

  get(journalId: string) {
    const journal = this.journals.get(journalId);
    return journal ? clone(journal) : null;
  }

  search(input: Partial<Pick<TradeJournal, "experimentId" | "instrument" | "outcome">> & { ruleVersion?: number }) {
    return Array.from(this.journals.values())
      .filter((journal) => !input.experimentId || journal.experimentId === input.experimentId)
      .filter((journal) => !input.instrument || journal.instrument === input.instrument)
      .filter((journal) => !input.outcome || journal.outcome === input.outcome)
      .filter((journal) => !input.ruleVersion || journal.ruleVersion === input.ruleVersion)
      .map(clone);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
