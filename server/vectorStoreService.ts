import { Pool } from "pg";

export type VectorRecord = {
  id: string;
  vector: number[];
  text: string;
  metadata: Record<string, unknown>;
};

export type VectorSearchResult = VectorRecord & { score: number };

export interface VectorStore {
  upsert(record: VectorRecord): Promise<VectorRecord>;
  search(vector: number[], limit?: number): Promise<VectorSearchResult[]>;
  list(limit?: number): Promise<VectorRecord[]>;
  health(): { provider: "memory" | "postgres" | "qdrant"; status: "healthy" | "disabled"; records: number; capabilities: string[] };
}

export class InMemoryVectorStore implements VectorStore {
  private records = new Map<string, VectorRecord>();

  async upsert(record: VectorRecord): Promise<VectorRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async search(vector: number[], limit = 5): Promise<VectorSearchResult[]> {
    return Array.from(this.records.values())
      .map((record) => ({ ...record, score: cosine(vector, record.vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async list(limit = 10): Promise<VectorRecord[]> {
    return Array.from(this.records.values()).slice(0, limit);
  }

  health() {
    return { provider: "memory" as const, status: "healthy" as const, records: this.records.size, capabilities: ["upsert", "search", "list"] };
  }
}

export class PgVectorStore implements VectorStore {
  private readonly fallback = new InMemoryVectorStore();
  private readonly configured: boolean;
  private readonly pool: Pool | null;

  constructor(private readonly databaseUrl = process.env.DATABASE_URL) {
    this.configured = Boolean(databaseUrl);
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async upsert(record: VectorRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.fallback.upsert(record);
    await this.pool.query(
      `INSERT INTO vector_records (id, vector, text, metadata)
       VALUES ($1, $2::jsonb, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET vector = EXCLUDED.vector, text = EXCLUDED.text, metadata = EXCLUDED.metadata`,
      [record.id, JSON.stringify(record.vector), record.text, JSON.stringify(record.metadata)],
    );
    return record;
  }

  async search(vector: number[], limit = 5) {
    if (!this.pool) return this.fallback.search(vector, limit);
    const response = await this.pool.query(`SELECT id, vector, text, metadata FROM vector_records`);
    const records = response.rows.map((row) => ({
      id: String(row.id),
      vector: Array.isArray(row.vector) ? row.vector.map(Number) : [],
      text: String(row.text),
      metadata: row.metadata ?? {},
    }));
    return records
      .map((record) => ({ ...record, score: cosine(vector, record.vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async list(limit = 10): Promise<VectorRecord[]> {
    if (!this.pool) return this.fallback.list(limit);
    const response = await this.pool.query(`SELECT id, vector, text, metadata FROM vector_records ORDER BY id DESC LIMIT $1`, [limit]);
    return response.rows.map((row) => ({
      id: String(row.id),
      vector: Array.isArray(row.vector) ? row.vector.map(Number) : [],
      text: String(row.text),
      metadata: row.metadata ?? {},
    }));
  }

  health() {
    return {
      provider: "postgres" as const,
      status: this.configured ? "healthy" as const : "disabled" as const,
      records: this.fallback.health().records,
      capabilities: ["upsert", "search", "list", "env-gated", "postgres_fallback"],
    };
  }

  async close() {
    await this.pool?.end();
  }
}

export class QdrantVectorStore implements VectorStore {
  private fallback = new PgVectorStore();

  async upsert(record: VectorRecord) {
    return this.fallback.upsert(record);
  }

  async search(vector: number[], limit = 5) {
    return this.fallback.search(vector, limit);
  }

  async list(limit = 10) {
    return this.fallback.list(limit);
  }

  health() {
    return {
      provider: "qdrant" as const,
      status: process.env.QDRANT_URL ? "healthy" as const : "disabled" as const,
      records: this.fallback.health().records,
      capabilities: ["upsert", "search", "list", "env-gated", "postgres_fallback"],
    };
  }
}

export const vectorStore: VectorStore = process.env.QDRANT_URL ? new QdrantVectorStore() : process.env.DATABASE_URL ? new PgVectorStore() : new InMemoryVectorStore();

function cosine(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    leftMag += left[i] ** 2;
    rightMag += right[i] ** 2;
  }
  if (leftMag === 0 || rightMag === 0) return 0;
  return Number((dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag))).toFixed(4));
}
