import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { StrategyDefinition } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgStrategyDefinitionRepository {
  private readonly evidence: PgEvidenceRepository<StrategyDefinition & { lineageEventIds: string[] }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_strategy_definitions",
      schemaVersion: "fincoach.v2.strategy.1",
      sourceModule: "rules",
      idOf: record => record.strategyId,
      naturalKeyOf: record => `${record.strategyId}:${record.strategyVersion}`,
      idempotencyKeyOf: record => record.fingerprint,
      createdAtOf: record => record.createdAt,
    });
  }

  save(strategy: StrategyDefinition) {
    return this.evidence.save({ ...strategy, lineageEventIds: [strategy.hypothesisId] });
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; symbol?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; symbol?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
