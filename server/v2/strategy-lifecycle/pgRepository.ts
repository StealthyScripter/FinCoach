import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { StrategyLifecycleDecision } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgStrategyLifecycleRepository {
  private readonly evidence: PgEvidenceRepository<StrategyLifecycleDecision>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_strategy_lifecycle_decisions",
      schemaVersion: "fincoach.v2.strategy-lifecycle.1",
      sourceModule: "strategy-lifecycle",
      idOf: record => record.decisionId,
      naturalKeyOf: record => record.decisionId,
      idempotencyKeyOf: record => record.decisionId,
      createdAtOf: record => record.createdAt,
    });
  }
  save(decision: StrategyLifecycleDecision) { return this.evidence.save(decision).then(result => ({ inserted: result.inserted, decision: result.record, conflict: result.conflict })); }
  async history(strategyId: string) { return (await this.evidence.list({ strategyId })).items; }
  async list(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  snapshot() { return this.list(); }
  health() { return this.evidence.health(); }
}
