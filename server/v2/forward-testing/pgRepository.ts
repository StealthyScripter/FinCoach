import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ForwardTestRecord } from "./contracts";
import type { EligibleForwardTestsForSignalQuery } from "./repository";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgForwardTestingRepository {
  private readonly evidence: PgEvidenceRepository<ForwardTestRecord>;
  constructor(private readonly db: Queryable) {
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
  async eligibleForSignal(input: EligibleForwardTestsForSignalQuery) {
    void input.now;
    const result = await this.db.query(
      `SELECT payload
       FROM v2_forward_tests
       WHERE payload->>'status' IN ('monitoring', 'completed')
         AND (payload->'demoVerification'->>'demoOnly')::boolean = true
         AND payload->'demoVerification'->>'accountMode' = payload->'demoVerification'->>'environment'
         AND (payload->'snapshot'->>'fresh')::boolean = true
         AND jsonb_array_length(lineage_event_ids) > 0
         AND jsonb_array_length(payload->'snapshot'->'lineageEventIds') > 0
         AND (payload->>'expiresAt' IS NULL OR (payload->>'expiresAt')::timestamptz > $2::timestamptz)
         AND (payload->>'supersedesId' IS NULL OR payload->>'supersedesId' = '')
       ORDER BY created_at DESC, record_id ASC
       LIMIT $1`,
      [input.limit, input.now.toISOString()],
    );
    return result.rows.map((row: { payload: ForwardTestRecord }) => row.payload);
  }
  async list(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
