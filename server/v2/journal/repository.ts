import type { ResearchJournalEntry } from "./contracts";

export class InMemoryResearchJournalRepository {
  private readonly entries = new Map<string, ResearchJournalEntry>();

  constructor(seed: readonly ResearchJournalEntry[] = []) {
    for (const entry of seed) this.entries.set(entry.journalEntryId, freezeEntry(entry));
  }

  append(entry: ResearchJournalEntry): { inserted: boolean; entry: ResearchJournalEntry } {
    const existing = this.entries.get(entry.journalEntryId);
    if (existing) return { inserted: false, entry: existing };
    const frozen = freezeEntry(entry);
    this.entries.set(frozen.journalEntryId, frozen);
    return { inserted: true, entry: frozen };
  }

  get(id: string) {
    return this.entries.get(id) ?? null;
  }

  has(id: string) {
    return this.entries.has(id);
  }

  list() {
    return [...this.entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.journalEntryId.localeCompare(b.journalEntryId));
  }

  snapshot() {
    return this.list();
  }
}

function freezeEntry(entry: ResearchJournalEntry): ResearchJournalEntry {
  const copy: ResearchJournalEntry = {
    ...entry,
    evidence: deepFreeze({ ...entry.evidence }),
    limitations: Object.freeze([...entry.limitations]),
    lineageEventIds: Object.freeze([...entry.lineageEventIds]),
  };
  return deepFreeze(copy) as ResearchJournalEntry;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
    }
  }
  return value;
}
