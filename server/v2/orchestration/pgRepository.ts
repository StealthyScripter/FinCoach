import { createHash, randomUUID } from "crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  ConsumerAcknowledgement,
  DurableWorkerLease,
  OrchestrationCheckpoint,
  OrchestrationDeadLetter,
  OrchestrationErrorCode,
  ResearchCycleRecord,
  RetryState,
} from "./contracts";
import { classifyPostgresError, requireObject, requireSchemaVersion, V2PersistenceError } from "../persistence/errors";

const ORCHESTRATION_SCHEMA_VERSION = "fincoach.v2.orchestration.1";

type Queryable = Pick<Pool | PoolClient, "query">;

export type SaveResult<T> = { inserted: boolean; record: T; conflict?: "idempotent" | "conflicting" };

export class PgOrchestrationRepository {
  constructor(private readonly db: Queryable) {}

  async saveCycle(cycle: ResearchCycleRecord): Promise<SaveResult<ResearchCycleRecord>> {
    try {
      const existing = await this.db.query("SELECT * FROM v2_orchestration_cycles WHERE idempotency_key = $1", [cycle.idempotencyKey]);
      if (existing.rowCount) {
        const record = mapCycle(existing.rows[0]);
        if (record.cycleId !== cycle.cycleId || record.requestedBy !== cycle.requestedBy) {
          return { inserted: false, record, conflict: "conflicting" };
        }
        return { inserted: false, record, conflict: "idempotent" };
      }
      const inserted = await this.db.query(
        `INSERT INTO v2_orchestration_cycles
          (cycle_id, schema_version, status, requested_by, idempotency_key, correlation_id, causation_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, '{}'::jsonb, $7, $8)
         RETURNING *`,
        [cycle.cycleId, ORCHESTRATION_SCHEMA_VERSION, cycle.status, cycle.requestedBy, cycle.idempotencyKey, cycle.correlationId, cycle.createdAt, cycle.updatedAt],
      );
      return { inserted: true, record: mapCycle(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async acknowledge(input: Omit<ConsumerAcknowledgement, "acknowledgementId" | "createdAt"> & { createdAt?: string }): Promise<SaveResult<ConsumerAcknowledgement>> {
    try {
      const now = input.createdAt ?? new Date().toISOString();
      const acknowledgementId = createHash("sha256").update(`${input.sourceEventId}:${input.consumerId}`).digest("hex");
      const existing = await this.db.query("SELECT * FROM v2_orchestration_consumer_acknowledgements WHERE idempotency_key = $1 OR (source_event_id = $2 AND consumer_id = $3)", [
        input.idempotencyKey,
        input.sourceEventId,
        input.consumerId,
      ]);
      if (existing.rowCount) {
        const record = mapAcknowledgement(existing.rows[0]);
        if (record.idempotencyKey === input.idempotencyKey && record.resultHash === input.resultHash) {
          return { inserted: false, record, conflict: "idempotent" };
        }
        return { inserted: false, record, conflict: "conflicting" };
      }
      const inserted = await this.db.query(
        `INSERT INTO v2_orchestration_consumer_acknowledgements
          (acknowledgement_id, schema_version, source_event_id, consumer_id, idempotency_key, result_hash, correlation_id, causation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [acknowledgementId, ORCHESTRATION_SCHEMA_VERSION, input.sourceEventId, input.consumerId, input.idempotencyKey, input.resultHash, input.correlationId, input.causationId, now],
      );
      return { inserted: true, record: mapAcknowledgement(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async checkpoint(record: OrchestrationCheckpoint & { correlationId: string; causationId?: string | null }): Promise<OrchestrationCheckpoint> {
    try {
      const now = new Date().toISOString();
      const saved = await this.db.query(
        `INSERT INTO v2_orchestration_checkpoints
          (consumer_id, schema_version, source_event_id, idempotency_key, attempt, correlation_id, causation_id, checkpointed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (consumer_id) DO UPDATE SET
          source_event_id = EXCLUDED.source_event_id,
          idempotency_key = EXCLUDED.idempotency_key,
          attempt = EXCLUDED.attempt,
          correlation_id = EXCLUDED.correlation_id,
          causation_id = EXCLUDED.causation_id,
          checkpointed_at = EXCLUDED.checkpointed_at,
          updated_at = EXCLUDED.updated_at
         WHERE v2_orchestration_checkpoints.attempt <= EXCLUDED.attempt
         RETURNING *`,
        [record.consumerId, ORCHESTRATION_SCHEMA_VERSION, record.sourceEventId, record.idempotencyKey, record.attempt, record.correlationId, record.causationId ?? null, record.checkpointedAt, now],
      );
      if (!saved.rowCount) throw new V2PersistenceError("optimistic_concurrency_conflict", "Checkpoint attempt regressed");
      return mapCheckpoint(saved.rows[0]);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async acknowledgeAndCheckpoint(input: {
    acknowledgement: Omit<ConsumerAcknowledgement, "acknowledgementId" | "createdAt"> & { createdAt?: string };
    checkpoint: OrchestrationCheckpoint & { correlationId: string; causationId?: string | null };
  }): Promise<{ acknowledgement: ConsumerAcknowledgement; checkpoint: OrchestrationCheckpoint }> {
    const client = await this.requirePoolClient();
    await client.query("BEGIN");
    try {
      const transactional = new PgOrchestrationRepository(client);
      const acknowledgement = await transactional.acknowledge(input.acknowledgement);
      if (acknowledgement.conflict === "conflicting") throw new V2PersistenceError("conflicting_duplicate", "Conflicting consumer acknowledgement");
      const checkpoint = await transactional.checkpoint(input.checkpoint);
      await client.query("COMMIT");
      return { acknowledgement: acknowledgement.record, checkpoint };
    } catch (error) {
      await client.query("ROLLBACK");
      throw classifyPostgresError(error);
    } finally {
      client.release();
    }
  }

  async checkpointFor(consumerId: string): Promise<OrchestrationCheckpoint | null> {
    try {
      const result = await this.db.query("SELECT * FROM v2_orchestration_checkpoints WHERE consumer_id = $1", [consumerId]);
      return result.rowCount ? mapCheckpoint(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async saveRetry(input: Omit<RetryState, "retryId" | "createdAt" | "updatedAt"> & { updatedAt?: string }): Promise<RetryState> {
    try {
      const now = input.updatedAt ?? new Date().toISOString();
      const retryId = createHash("sha256").update(`${input.sourceEventId}:${input.consumerId}`).digest("hex");
      const saved = await this.db.query(
        `INSERT INTO v2_orchestration_retries
          (retry_id, schema_version, source_event_id, consumer_id, idempotency_key, attempt, max_attempts, exhausted, next_retry_at, last_error_code, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         ON CONFLICT (source_event_id, consumer_id) DO UPDATE SET
          idempotency_key = EXCLUDED.idempotency_key,
          attempt = EXCLUDED.attempt,
          max_attempts = EXCLUDED.max_attempts,
          exhausted = EXCLUDED.exhausted,
          next_retry_at = EXCLUDED.next_retry_at,
          last_error_code = EXCLUDED.last_error_code,
          correlation_id = EXCLUDED.correlation_id,
          causation_id = EXCLUDED.causation_id,
          updated_at = EXCLUDED.updated_at
         WHERE v2_orchestration_retries.attempt <= EXCLUDED.attempt
         RETURNING *`,
        [retryId, ORCHESTRATION_SCHEMA_VERSION, input.sourceEventId, input.consumerId, input.idempotencyKey, input.attempt, input.maxAttempts, input.exhausted, input.nextRetryAt, input.lastErrorCode, input.correlationId, input.causationId, now],
      );
      if (!saved.rowCount) throw new V2PersistenceError("optimistic_concurrency_conflict", "Retry attempt regressed");
      return mapRetry(saved.rows[0]);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async retryFor(sourceEventId: string, consumerId: string): Promise<RetryState | null> {
    try {
      const result = await this.db.query("SELECT * FROM v2_orchestration_retries WHERE source_event_id = $1 AND consumer_id = $2", [sourceEventId, consumerId]);
      return result.rowCount ? mapRetry(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async acquireLease(input: { leaseName: string; workerId: string; now: Date; ttlMs: number; correlationId: string; causationId?: string | null }): Promise<DurableWorkerLease | null> {
    try {
      const expiresAt = new Date(input.now.getTime() + input.ttlMs);
      const result = await this.db.query(
        `INSERT INTO v2_orchestration_worker_leases
          (lease_name, schema_version, worker_id, fencing_token, acquired_at, renewed_at, expires_at, released_at, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, $4, $5, NULL, $6, $7, $4, $4)
         ON CONFLICT (lease_name) DO UPDATE SET
          worker_id = EXCLUDED.worker_id,
          fencing_token = v2_orchestration_worker_leases.fencing_token + 1,
          acquired_at = EXCLUDED.acquired_at,
          renewed_at = EXCLUDED.renewed_at,
          expires_at = EXCLUDED.expires_at,
          released_at = NULL,
          correlation_id = EXCLUDED.correlation_id,
          causation_id = EXCLUDED.causation_id,
          updated_at = EXCLUDED.updated_at
         WHERE v2_orchestration_worker_leases.released_at IS NOT NULL OR v2_orchestration_worker_leases.expires_at <= EXCLUDED.acquired_at
         RETURNING *`,
        [input.leaseName, ORCHESTRATION_SCHEMA_VERSION, input.workerId, input.now.toISOString(), expiresAt.toISOString(), input.correlationId, input.causationId ?? null],
      );
      return result.rowCount ? mapLease(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async renewLease(input: { leaseName: string; workerId: string; fencingToken: number; now: Date; ttlMs: number; correlationId: string }): Promise<DurableWorkerLease | null> {
    try {
      const expiresAt = new Date(input.now.getTime() + input.ttlMs);
      const result = await this.db.query(
        `UPDATE v2_orchestration_worker_leases
         SET renewed_at = $4, expires_at = $5, correlation_id = $6, updated_at = $4
         WHERE lease_name = $1 AND worker_id = $2 AND fencing_token = $3 AND released_at IS NULL AND expires_at > $4
         RETURNING *`,
        [input.leaseName, input.workerId, input.fencingToken, input.now.toISOString(), expiresAt.toISOString(), input.correlationId],
      );
      return result.rowCount ? mapLease(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async releaseLease(input: { leaseName: string; workerId: string; fencingToken: number; now: Date }): Promise<boolean> {
    try {
      const result = await this.db.query(
        `UPDATE v2_orchestration_worker_leases
         SET released_at = $4, updated_at = $4
         WHERE lease_name = $1 AND worker_id = $2 AND fencing_token = $3 AND released_at IS NULL`,
        [input.leaseName, input.workerId, input.fencingToken, input.now.toISOString()],
      );
      return Boolean(result.rowCount);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async activeLeases(now: Date): Promise<DurableWorkerLease[]> {
    try {
      const result = await this.db.query("SELECT * FROM v2_orchestration_worker_leases WHERE released_at IS NULL AND expires_at > $1 ORDER BY expires_at ASC, lease_name ASC", [now.toISOString()]);
      return result.rows.map(mapLease);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async addDeadLetter(record: OrchestrationDeadLetter & { correlationId: string; causationId?: string | null }): Promise<SaveResult<OrchestrationDeadLetter>> {
    try {
      const existing = await this.db.query("SELECT * FROM v2_orchestration_dead_letters WHERE source_event_id = $1 AND reason = $2", [record.sourceEventId, record.reason]);
      if (existing.rowCount) return { inserted: false, record: mapDeadLetter(existing.rows[0]), conflict: "idempotent" };
      const inserted = await this.db.query(
        `INSERT INTO v2_orchestration_dead_letters
          (dead_letter_id, schema_version, source_event_id, reason, retryable, replay_count, correlation_id, causation_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)
         RETURNING *`,
        [record.deadLetterId, ORCHESTRATION_SCHEMA_VERSION, record.sourceEventId, record.reason, record.retryable, record.correlationId, record.causationId ?? null, JSON.stringify(record.payload), record.createdAt],
      );
      return { inserted: true, record: mapDeadLetter(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async recordDeadLetterReplay(deadLetterId: string, now = new Date()): Promise<OrchestrationDeadLetter> {
    try {
      const result = await this.db.query(
        `UPDATE v2_orchestration_dead_letters
         SET replay_count = replay_count + 1, last_replay_requested_at = $2
         WHERE dead_letter_id = $1
         RETURNING *`,
        [deadLetterId, now.toISOString()],
      );
      if (!result.rowCount) throw new V2PersistenceError("persistence_integrity_failure", "Dead letter not found for replay");
      return mapDeadLetter(result.rows[0]);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async deadLetters(): Promise<OrchestrationDeadLetter[]> {
    try {
      const result = await this.db.query("SELECT * FROM v2_orchestration_dead_letters ORDER BY created_at ASC, dead_letter_id ASC");
      return result.rows.map(mapDeadLetter);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  private async requirePoolClient(): Promise<PoolClient> {
    const maybePool = this.db as Pool;
    if (typeof maybePool.connect !== "function") {
      throw new V2PersistenceError("persistence_integrity_failure", "Transactional operation requires a pg Pool");
    }
    return maybePool.connect();
  }
}

function mapCycle(row: QueryResultRow): ResearchCycleRecord {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    cycleId: String(row.cycle_id),
    status: row.status,
    requestedBy: String(row.requested_by),
    idempotencyKey: String(row.idempotency_key),
    correlationId: String(row.correlation_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAcknowledgement(row: QueryResultRow): ConsumerAcknowledgement {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    acknowledgementId: String(row.acknowledgement_id),
    sourceEventId: String(row.source_event_id),
    consumerId: String(row.consumer_id),
    idempotencyKey: String(row.idempotency_key),
    resultHash: String(row.result_hash),
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    createdAt: toIso(row.created_at),
  };
}

function mapCheckpoint(row: QueryResultRow): OrchestrationCheckpoint {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    consumerId: String(row.consumer_id),
    sourceEventId: String(row.source_event_id),
    idempotencyKey: String(row.idempotency_key),
    checkpointedAt: toIso(row.checkpointed_at),
    attempt: Number(row.attempt),
  };
}

function mapRetry(row: QueryResultRow): RetryState {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    retryId: String(row.retry_id),
    sourceEventId: String(row.source_event_id),
    consumerId: String(row.consumer_id),
    idempotencyKey: String(row.idempotency_key),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    exhausted: Boolean(row.exhausted),
    nextRetryAt: row.next_retry_at ? toIso(row.next_retry_at) : null,
    lastErrorCode: row.last_error_code as OrchestrationErrorCode,
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapLease(row: QueryResultRow): DurableWorkerLease {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    leaseName: String(row.lease_name),
    workerId: String(row.worker_id),
    fencingToken: Number(row.fencing_token),
    acquiredAt: new Date(row.acquired_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

function mapDeadLetter(row: QueryResultRow): OrchestrationDeadLetter {
  requireSchemaVersion(row.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  return {
    deadLetterId: String(row.dead_letter_id),
    sourceEventId: String(row.source_event_id),
    reason: row.reason as OrchestrationErrorCode,
    retryable: Boolean(row.retryable),
    createdAt: toIso(row.created_at),
    payload: requireObject(row.payload, "dead letter payload"),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
