import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { BacktestResult } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgBacktestRepository {
  private readonly evidence: PgEvidenceRepository<BacktestResult & { schemaVersion: "fincoach.v2.backtest.1" }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_backtest_results",
      schemaVersion: "fincoach.v2.backtest.1",
      sourceModule: "backtesting",
      idOf: record => record.backtestId,
      naturalKeyOf: record => record.backtestId,
      idempotencyKeyOf: record => record.backtestId,
      createdAtOf: record => record.createdAt,
    });
  }

  save(result: BacktestResult) {
    return this.evidence.save({ ...result, schemaVersion: "fincoach.v2.backtest.1" });
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; status?: string; strategyId?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; status?: string; strategyId?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
