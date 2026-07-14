import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { StrategyRankingDecision } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgRankingRepository {
  private readonly evidence: PgEvidenceRepository<StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] }>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_ranking_decisions",
      schemaVersion: "fincoach.v2.ranking.1",
      sourceModule: "ranking",
      idOf: record => record.rankingId,
      naturalKeyOf: record => record.rankingId,
      idempotencyKeyOf: record => record.rankingId,
      createdAtOf: record => record.generatedAt,
    });
  }
  save(decision: StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] }) { return this.evidence.save(decision); }
  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
