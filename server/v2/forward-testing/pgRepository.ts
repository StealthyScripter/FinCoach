import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ForwardTestRecord } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgForwardTestingRepository {
  private readonly evidence: PgEvidenceRepository<ForwardTestRecord>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_forward_tests",
      schemaVersion: "fincoach.v2.forward-test.1",
      sourceModule: "forward-testing",
      idOf: record => record.forwardTestId,
      naturalKeyOf: record => record.forwardTestId,
      idempotencyKeyOf: record => record.forwardTestId,
      createdAtOf: record => record.createdAt,
    });
  }
  save(record: ForwardTestRecord) { return this.evidence.save(record); }
  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
