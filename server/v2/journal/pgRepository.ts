import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ResearchJournalEntry } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgResearchJournalRepository {
  private readonly evidence: PgEvidenceRepository<ResearchJournalEntry>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_research_journal_entries",
      schemaVersion: "fincoach.v2.research-journal.1",
      sourceModule: "journal",
      idOf: record => record.journalEntryId,
      naturalKeyOf: record => record.journalEntryId,
      idempotencyKeyOf: record => record.journalEntryId,
      createdAtOf: record => record.createdAt,
      supersedesIdOf: record => record.supersedesEntryId,
    });
  }
  append(entry: ResearchJournalEntry) { return this.evidence.save(entry).then(result => ({ inserted: result.inserted, entry: result.record, record: result.record, conflict: result.conflict })); }
  get(id: string) { return this.evidence.get(id); }
  async has(id: string) { return Boolean(await this.get(id)); }
  async list(input: { limit?: number; offset?: number; subjectId?: string } = {}) { return (await this.evidence.list(input)).items; }
  async eligibleForLesson(input: { limit: number }) {
    const result = await this.evidence.list({ limit: input.limit });
    return result.items.filter(entry => entry.subjectType === "external_evaluation" && entry.lineageEventIds.length && ["tp", "sl", "expired", "cancelled"].includes(String((entry.evidence as { outcome?: unknown }).outcome))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.journalEntryId.localeCompare(b.journalEntryId)).slice(0, input.limit);
  }
  listPage(input: { limit?: number; offset?: number; subjectId?: string } = {}) { return this.evidence.list(input); }
  snapshot() { return this.list(); }
  health() { return this.evidence.health(); }
}
