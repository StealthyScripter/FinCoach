import type { Pool, PoolClient } from "pg";
import type { DemoPromotionRecord } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgDemoPromotionRepository {
  constructor(private readonly db: Queryable) {}
  async getForStrategy(strategyId: string) {
    const result = await this.db.query("SELECT payload FROM v2_demo_promotions WHERE strategy_id = $1 ORDER BY created_at DESC, promotion_id DESC LIMIT 1", [strategyId]);
    return (result.rows[0]?.payload as DemoPromotionRecord | undefined) ?? null;
  }
  async history(strategyId: string) {
    const result = await this.db.query("SELECT payload FROM v2_demo_promotions WHERE strategy_id = $1 ORDER BY created_at ASC, promotion_id ASC", [strategyId]);
    return result.rows.map(row => row.payload as DemoPromotionRecord);
  }
  async save(record: DemoPromotionRecord) {
    const result = await this.db.query(
      `INSERT INTO v2_demo_promotions (promotion_id, strategy_id, idempotency_key, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT DO NOTHING RETURNING payload`,
      [record.promotionId, record.strategyId, record.idempotencyKey, JSON.stringify(record), record.approvedAt],
    );
    if (result.rows[0]?.payload) return result.rows[0].payload as DemoPromotionRecord;
    const existing = await this.db.query("SELECT payload FROM v2_demo_promotions WHERE promotion_id = $1 OR idempotency_key = $2 LIMIT 1", [record.promotionId, record.idempotencyKey]);
    return (existing.rows[0]?.payload as DemoPromotionRecord | undefined) ?? this.getForStrategy(record.strategyId);
  }
}

export class InMemoryDemoPromotionRepository {
  private readonly records = new Map<string, DemoPromotionRecord[]>();
  getForStrategy(strategyId: string) { return [...(this.records.get(strategyId) ?? [])].sort((a, b) => b.approvedAt.localeCompare(a.approvedAt) || b.promotionId.localeCompare(a.promotionId))[0] ?? null; }
  save(record: DemoPromotionRecord) {
    const history = this.records.get(record.strategyId) ?? [];
    const existing = history.find(item => item.idempotencyKey === record.idempotencyKey || item.promotionId === record.promotionId);
    if (existing) return existing;
    history.push(record);
    this.records.set(record.strategyId, history);
    return record;
  }
  history(strategyId: string) { return [...(this.records.get(strategyId) ?? [])].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.promotionId.localeCompare(b.promotionId)); }
}
