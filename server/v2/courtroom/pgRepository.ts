import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { StrategyCourtCase } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgCourtroomRepository {
  private readonly evidence: PgEvidenceRepository<StrategyCourtCase & { lineageEventIds: string[] }>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_court_verdicts",
      schemaVersion: "fincoach.v2.court.1",
      sourceModule: "courtroom",
      idOf: record => record.caseId,
      naturalKeyOf: record => record.caseId,
      idempotencyKeyOf: record => record.caseId,
      createdAtOf: record => record.createdAt,
    });
  }
  save(record: StrategyCourtCase & { lineageEventIds: string[] }) { return this.evidence.save(record); }
  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
