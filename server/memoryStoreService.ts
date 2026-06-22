import type { MemoryRecord } from "@shared/schema";
import { Pool } from "pg";

export type MemoryScope = "short_term" | "long_term" | "semantic";

export interface MemoryStore {
  append(input: { userId: string; scope: MemoryScope; record: MemoryRecord }): Promise<MemoryRecord>;
  list(input: { userId: string; scope?: MemoryScope; limit?: number }): Promise<MemoryRecord[]>;
  health(): { provider: "memory" | "postgres"; status: "healthy" | "disabled"; records: number; scopes: Record<MemoryScope, number> };
  clearForTest?(): void;
  close?(): Promise<void>;
}

type StoredMemoryRecord = MemoryRecord & { userId: string; scope: MemoryScope };

export class InMemoryMemoryStore implements MemoryStore {
  private records: StoredMemoryRecord[] = [];

  async append(input: { userId: string; scope: MemoryScope; record: MemoryRecord }) {
    this.records.push({ ...input.record, userId: input.userId, scope: input.scope });
    return input.record;
  }

  async list(input: { userId: string; scope?: MemoryScope; limit?: number }) {
    const limit = input.limit ?? 50;
    return this.records
      .filter((record) => record.userId === input.userId && (input.scope ? record.scope === input.scope : true))
      .slice(-limit)
      .reverse()
      .map(({ userId: _userId, scope: _scope, ...record }) => record);
  }

  health() {
    return {
      provider: "memory" as const,
      status: "healthy" as const,
      records: this.records.length,
      scopes: summarizeScopes(this.records),
    };
  }

  clearForTest() {
    this.records.length = 0;
  }
}

export class PgMemoryStore implements MemoryStore {
  private readonly pool: Pool | null;
  private persistedRecords = 0;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async append(input: { userId: string; scope: MemoryScope; record: MemoryRecord }) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO memory_records
        (id, user_id, scope, kind, text, tags, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.record.id,
        input.userId,
        input.scope,
        input.record.kind,
        input.record.text,
        JSON.stringify(input.record.tags),
        JSON.stringify(input.record.metadata),
        input.record.createdAt,
      ],
    );
    this.persistedRecords += 1;
    return input.record;
  }

  async list(input: { userId: string; scope?: MemoryScope; limit?: number }) {
    if (!this.pool) return [];
    const params: Array<string | number> = [input.userId];
    let query = `SELECT * FROM memory_records WHERE user_id = $1`;
    if (input.scope) {
      params.push(input.scope);
      query += ` AND scope = $2`;
    }
    params.push(input.limit ?? 50);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const response = await this.pool.query(query, params);
    return response.rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as MemoryRecord["kind"],
      text: String(row.text),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      metadata: row.metadata ?? {},
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  health() {
    return {
      provider: "postgres" as const,
      status: this.pool ? "healthy" as const : "disabled" as const,
      records: this.persistedRecords,
      scopes: { short_term: 0, long_term: 0, semantic: 0 },
    };
  }

  async close() {
    await this.pool?.end();
  }
}

export const memoryStore: MemoryStore = process.env.DATABASE_URL ? new PgMemoryStore() : new InMemoryMemoryStore();

function summarizeScopes(records: StoredMemoryRecord[]) {
  return {
    short_term: records.filter((record) => record.scope === "short_term").length,
    long_term: records.filter((record) => record.scope === "long_term").length,
    semantic: records.filter((record) => record.scope === "semantic").length,
  };
}
