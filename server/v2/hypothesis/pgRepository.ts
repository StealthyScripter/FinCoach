import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ResearchHypothesis } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgHypothesisRepository {
  private readonly evidence: PgEvidenceRepository<ResearchHypothesis & { lineageEventIds: string[] }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_research_hypotheses",
      schemaVersion: "fincoach.v2.hypothesis.1",
      sourceModule: "hypothesis",
      idOf: record => record.hypothesisId,
      naturalKeyOf: record => record.fingerprint,
      idempotencyKeyOf: record => record.fingerprint,
      createdAtOf: record => record.createdAt,
    });
  }

  async save(hypothesis: ResearchHypothesis) {
    const saved = await this.evidence.save({ ...hypothesis, lineageEventIds: hypothesis.evidenceEventIds });
    return { inserted: saved.inserted, hypothesis: saved.record, existing: saved.inserted ? null : saved.record };
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
