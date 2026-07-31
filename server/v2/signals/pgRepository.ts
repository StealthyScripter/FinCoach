import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { V2ResearchSignal } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgSignalRepository {
  private readonly evidence: PgEvidenceRepository<V2ResearchSignal>;
  constructor(private readonly db: Queryable) {
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
  save(signal: V2ResearchSignal) { return this.evidence.save(signal).then(result => ({ inserted: result.inserted, signal: result.record, record: result.record, conflict: result.conflict })); }
  get(id: string) { return this.evidence.get(id); }
  async eligibleForEvaluation(input: { now: Date; limit: number }) {
    const result = await this.db.query(
      `SELECT payload FROM v2_research_signals
       WHERE (payload->>'demoOnly')::boolean = true
         AND jsonb_array_length(lineage_event_ids) > 0
         AND (payload->>'validUntil')::timestamptz > $2::timestamptz
       ORDER BY created_at DESC, record_id ASC
       LIMIT $1`,
      [input.limit, input.now.toISOString()],
    );
    return result.rows.map((row: { payload: V2ResearchSignal }) => row.payload);
  }
  async list(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
