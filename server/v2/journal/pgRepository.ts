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
  append(entry: ResearchJournalEntry) { return this.evidence.save(entry).then(result => ({ inserted: result.inserted, entry: result.record, conflict: result.conflict })); }
  get(id: string) { return this.evidence.get(id); }
  async has(id: string) { return Boolean(await this.get(id)); }
  async list(input: { limit?: number; offset?: number; subjectId?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; subjectId?: string } = {}) { return this.evidence.list(input); }
  snapshot() { return this.list(); }
  health() { return this.evidence.health(); }
}
