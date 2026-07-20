import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgV2RuntimeRepository {
  constructor(private readonly db: Queryable) {}

  async health() {
    await this.db.query("SELECT 1");
    return { ok: true as const };
  }

  async recordBoot(input: {
    bootId: string;
    runtimeEnabled: boolean;
    researchEnabled: boolean;
    liveExecutionEnabled: boolean;
    heapLimitBytes: number;
    payload: Record<string, unknown>;
    createdAt: string;
  }) {
    await this.db.query(
      `INSERT INTO v2_runtime_boot_records
        (boot_id, schema_version, previous_boot_id, inferred_previous_exit, runtime_enabled, research_enabled, live_execution_enabled, heap_limit_bytes, payload, created_at)
       VALUES ($1, 'fincoach.v2.runtime-boot.1', NULL, 'unknown', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (boot_id) DO NOTHING`,
      [input.bootId, input.runtimeEnabled, input.researchEnabled, input.liveExecutionEnabled, input.heapLimitBytes, JSON.stringify(input.payload), input.createdAt],
    );
  }
}
