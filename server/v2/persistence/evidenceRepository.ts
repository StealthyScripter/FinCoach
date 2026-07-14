import { createHash } from "crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { classifyPostgresError, requireObject, requireSchemaVersion, V2PersistenceError } from "./errors";

type Queryable = Pick<Pool | PoolClient, "query">;

export type EvidenceRecordShape = {
  schemaVersion?: string;
  correlationId?: string;
  causationId?: string | null;
  createdAt?: string;
  lineageEventIds?: readonly string[];
};

export type EvidenceSaveResult<T> = { inserted: boolean; record: T; conflict?: "idempotent" | "conflicting" };

export type EvidenceRepositoryConfig<T extends EvidenceRecordShape> = {
  tableName: string;
  schemaVersion: string;
  sourceModule: string;
  idOf(record: T): string;
  naturalKeyOf(record: T): string;
  idempotencyKeyOf(record: T): string;
  createdAtOf(record: T): string;
  supersedesIdOf?(record: T): string | null;
  validate?(record: T): void;
};

export class PgEvidenceRepository<T extends EvidenceRecordShape> {
  constructor(private readonly db: Queryable, private readonly config: EvidenceRepositoryConfig<T>) {}

  async save(record: T): Promise<EvidenceSaveResult<T>> {
    try {
      this.validateRecord(record);
      const id = this.config.idOf(record);
      const naturalKey = this.config.naturalKeyOf(record);
      const idempotencyKey = this.config.idempotencyKeyOf(record);
      const existing = await this.db.query(`SELECT * FROM ${this.config.tableName} WHERE record_id = $1 OR natural_key = $2 OR idempotency_key = $3`, [id, naturalKey, idempotencyKey]);
      if (existing.rowCount) {
        const current = this.map(existing.rows[0]);
        return {
          inserted: false,
          record: current,
          conflict: fingerprint(current) === fingerprint(record) ? "idempotent" : "conflicting",
        };
      }
      const inserted = await this.db.query(
        `INSERT INTO ${this.config.tableName}
          (record_id, schema_version, natural_key, idempotency_key, source_module, payload, lineage_event_ids, supersedes_id, correlation_id, causation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          id,
          this.config.schemaVersion,
          naturalKey,
          idempotencyKey,
          this.config.sourceModule,
          JSON.stringify(record),
          JSON.stringify(record.lineageEventIds ?? []),
          this.config.supersedesIdOf?.(record) ?? null,
          record.correlationId ?? "",
          record.causationId ?? null,
          this.config.createdAtOf(record),
        ],
      );
      return { inserted: true, record: this.map(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async get(id: string): Promise<T | null> {
    try {
      const result = await this.db.query(`SELECT * FROM ${this.config.tableName} WHERE record_id = $1`, [id]);
      return result.rowCount ? this.map(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async list(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string; status?: string; subjectId?: string } = {}): Promise<{ items: T[]; total: number }> {
    try {
      const limit = input.limit ?? 100;
      const offset = input.offset ?? 0;
      const filters: string[] = [];
      const params: unknown[] = [];
      for (const [key, value] of Object.entries({ strategyId: input.strategyId, symbol: input.symbol, status: input.status, subjectId: input.subjectId })) {
        if (value) {
          params.push(value);
          filters.push(`payload->>'${key}' = $${params.length}`);
        }
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const items = await this.db.query(`SELECT * FROM ${this.config.tableName} ${where} ORDER BY created_at DESC, record_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
      const total = await this.db.query(`SELECT count(*)::int AS total FROM ${this.config.tableName} ${where}`, params);
      return { items: items.rows.map(row => this.map(row)), total: Number(total.rows[0]?.total ?? 0) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async health() {
    try {
      const result = await this.db.query(`SELECT count(*)::int AS total FROM ${this.config.tableName}`);
      return { availability: Number(result.rows[0]?.total ?? 0) > 0 ? "available" : "available_empty", total: Number(result.rows[0]?.total ?? 0) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  private validateRecord(record: T) {
    if (record.schemaVersion !== this.config.schemaVersion && (record as { schema?: string }).schema !== this.config.schemaVersion) {
      throw new V2PersistenceError("unsupported_schema_version", `Unsupported evidence schema version for ${this.config.tableName}`);
    }
    if (!record.correlationId) throw new V2PersistenceError("malformed_persisted_record", "Evidence record missing correlationId");
    if (!Array.isArray(record.lineageEventIds)) throw new V2PersistenceError("malformed_persisted_record", "Evidence record missing lineageEventIds");
    this.config.validate?.(record);
  }

  private map(row: QueryResultRow): T {
    requireSchemaVersion(row.schema_version, this.config.schemaVersion);
    const record = requireObject(row.payload, "evidence payload") as T;
    this.validateRecord(record);
    if (this.config.idOf(record) !== row.record_id) throw new V2PersistenceError("malformed_persisted_record", "Evidence payload does not match row identity");
    return record;
  }
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
