import type { Pool, PoolClient } from "pg";
import type { DemoPromotionRecord } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgDemoPromotionRepository {
  constructor(private readonly db: Queryable) {}
  async getForStrategy(strategyId: string) {
    const result = await this.db.query("SELECT payload FROM v2_demo_promotions WHERE strategy_id = $1", [strategyId]);
    return (result.rows[0]?.payload as DemoPromotionRecord | undefined) ?? null;
  }
  async save(record: DemoPromotionRecord) {
    const result = await this.db.query(
      `INSERT INTO v2_demo_promotions (promotion_id, strategy_id, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (strategy_id) DO NOTHING RETURNING payload`,
      [record.promotionId, record.strategyId, JSON.stringify(record), record.approvedAt],
    );
    return (result.rows[0]?.payload as DemoPromotionRecord | undefined) ?? this.getForStrategy(record.strategyId);
  }
}

export class InMemoryDemoPromotionRepository {
  private readonly records = new Map<string, DemoPromotionRecord>();
  getForStrategy(strategyId: string) { return this.records.get(strategyId) ?? null; }
  save(record: DemoPromotionRecord) { const existing = this.records.get(record.strategyId); if (existing) return existing; this.records.set(record.strategyId, record); return record; }
}
