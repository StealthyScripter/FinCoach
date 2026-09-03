import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { V2ExecutionRequest } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgV2ExecutionRequestRepository {
  private readonly evidence: PgEvidenceRepository<V2ExecutionRequest>;
  constructor(private readonly db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_execution_requests",
      schemaVersion: "fincoach.v2.execution-request.1",
      sourceModule: "v2-execution-bridge",
      idOf: record => record.executionRequestId,
      naturalKeyOf: record => record.signalId,
      idempotencyKeyOf: record => record.idempotencyKey,
      createdAtOf: record => record.createdAt,
    });
  }
  save(record: V2ExecutionRequest) { return this.evidence.save(record); }
  get(id: string) { return this.evidence.get(id); }
  async getBySignal(signalId: string) {
    const result = await this.db.query("SELECT payload FROM v2_execution_requests WHERE payload->>'signalId' = $1 ORDER BY created_at DESC LIMIT 1", [signalId]);
    return (result.rows[0]?.payload as V2ExecutionRequest | undefined) ?? null;
  }
  async getByBrokerTrade(brokerTradeId: string) {
    const result = await this.db.query("SELECT payload FROM v2_execution_requests WHERE payload->>'brokerTradeId' = $1 ORDER BY created_at DESC LIMIT 1", [brokerTradeId]);
    return (result.rows[0]?.payload as V2ExecutionRequest | undefined) ?? null;
  }
  async update(id: string, patch: Partial<V2ExecutionRequest>) {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.db.query("UPDATE v2_execution_requests SET payload = $2::jsonb, updated_at = now() WHERE record_id = $1", [id, JSON.stringify(next)]);
    return next;
  }
}

export class InMemoryV2ExecutionRequestRepository {
  private readonly records = new Map<string, V2ExecutionRequest>();
  save(record: V2ExecutionRequest) {
    const existing = [...this.records.values()].find(item => item.executionRequestId === record.executionRequestId || item.signalId === record.signalId || item.idempotencyKey === record.idempotencyKey);
    if (existing) return { inserted: false, record: existing, conflict: "idempotent" as const };
    this.records.set(record.executionRequestId, { ...record });
    return { inserted: true, record };
  }
  get(id: string) { return this.records.get(id) ?? null; }
  getBySignal(signalId: string) { return [...this.records.values()].find(item => item.signalId === signalId) ?? null; }
  getByBrokerTrade(brokerTradeId: string) { return [...this.records.values()].find(item => item.brokerTradeId === brokerTradeId) ?? null; }
  update(id: string, patch: Partial<V2ExecutionRequest>) { const current = this.get(id); if (!current) return null; const next = { ...current, ...patch }; this.records.set(id, next); return next; }
  list() { return [...this.records.values()]; }
}
