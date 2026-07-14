import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { V2ResearchSignal } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgSignalRepository {
  private readonly evidence: PgEvidenceRepository<V2ResearchSignal>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_research_signals",
      schemaVersion: "fincoach.signal.v2",
      sourceModule: "signals",
      idOf: record => record.signalId,
      naturalKeyOf: record => record.signalId,
      idempotencyKeyOf: record => record.signalId,
      createdAtOf: record => record.createdAt,
    });
  }
  save(signal: V2ResearchSignal) { return this.evidence.save(signal).then(result => ({ inserted: result.inserted, signal: result.record, conflict: result.conflict })); }
  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
