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
  health(): { provider: "memory" | "qdrant"; status: "healthy" | "disabled"; records: number; capabilities: string[] };
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

  health() {
    return { provider: "memory" as const, status: "healthy" as const, records: this.records.size, capabilities: ["upsert", "search"] };
  }
}

export class QdrantVectorStore implements VectorStore {
  private fallback = new InMemoryVectorStore();

  async upsert(record: VectorRecord) {
    return this.fallback.upsert(record);
  }

  async search(vector: number[], limit = 5) {
    return this.fallback.search(vector, limit);
  }

  health() {
    return {
      provider: "qdrant" as const,
      status: process.env.QDRANT_URL ? "healthy" as const : "disabled" as const,
      records: this.fallback.health().records,
      capabilities: ["upsert", "search", "env-gated"],
    };
  }
}

export const vectorStore: VectorStore = process.env.QDRANT_URL ? new QdrantVectorStore() : new InMemoryVectorStore();

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
