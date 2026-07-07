import { Client } from "pg";
import type { DemoRunMode, DemoRunState } from "@shared/demoRun";

export type PersistedDemoRunRecord = {
  runId: string;
  mode: DemoRunMode;
  state: DemoRunState;
  startTime: string;
  endTime: string | null;
  pausedAt: string | null;
  allowedSymbols: string[];
  allowedStrategies: string[];
  connectedProviders: string[];
  riskLimits: {
    maxDailyLoss: number;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    confidenceThreshold: number;
  };
  dailyReports: unknown[];
  adjustments: unknown[];
  screenVisits: Array<[string, number]>;
  finalReport: unknown | null;
};

export class DemoRunRecordStore {
  constructor(private readonly databaseUrl = process.env.DATABASE_URL) {}

  async loadLatest(): Promise<PersistedDemoRunRecord | null> {
    if (!this.databaseUrl) return null;
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await this.ensureTable(client);
      const result = await client.query(
        `SELECT payload
         FROM demo_run_records
         ORDER BY CASE WHEN state IN ('running', 'paused') THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`,
      );
      return this.normalizePayload(result.rows[0]?.payload);
    } finally {
      await client.end();
    }
  }

  async save(record: PersistedDemoRunRecord): Promise<void> {
    if (!this.databaseUrl) return;
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await this.ensureTable(client);
      await client.query(
        `INSERT INTO demo_run_records (run_id, mode, state, started_at, ended_at, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
         ON CONFLICT (run_id) DO UPDATE SET
           mode = EXCLUDED.mode,
           state = EXCLUDED.state,
           ended_at = EXCLUDED.ended_at,
           payload = EXCLUDED.payload,
           updated_at = now()`,
        [
          record.runId,
          record.mode,
          record.state,
          record.startTime,
          record.endTime,
          JSON.stringify(record),
        ],
      );
    } finally {
      await client.end();
    }
  }

  private async ensureTable(client: Client) {
    await client.query(
      `CREATE TABLE IF NOT EXISTS demo_run_records (
        run_id varchar PRIMARY KEY,
        mode text NOT NULL,
        state text NOT NULL,
        started_at timestamp NOT NULL,
        ended_at timestamp,
        payload jsonb NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      )`,
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_demo_run_records_updated_at ON demo_run_records (updated_at DESC)",
    );
  }

  private normalizePayload(payload: unknown): PersistedDemoRunRecord | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as PersistedDemoRunRecord;
    if (!record.runId || record.mode !== "demo_observation") return null;
    return {
      ...record,
      screenVisits: Array.isArray(record.screenVisits) ? record.screenVisits : [],
    };
  }
}

export const demoRunRecordStore = new DemoRunRecordStore();
