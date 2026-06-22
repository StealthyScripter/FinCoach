import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";
import type { BrokerReconciliationReport } from "./brokerReconciliationService";
import type { SandboxOrderResult } from "./brokerSandbox";

export type SubmissionReservation =
  | { status: "acquired"; reservationId: string }
  | { status: "replay"; result: SandboxOrderResult }
  | { status: "in_doubt" }
  | { status: "conflict" };

export interface TransactionalReliabilityRepository {
  reserveSubmission(key: string, fingerprint: string, reservationId: string): Promise<SubmissionReservation>;
  completeSubmission(key: string, reservationId: string, result: SandboxOrderResult): Promise<void>;
  markSubmissionInDoubt(key: string, reservationId: string): Promise<void>;
  abandonSubmission(key: string, reservationId: string): Promise<void>;
  resolveSubmission(key: string, decision: "record_not_submitted" | "record_broker_result", reviewedBy: string, result?: SandboxOrderResult): Promise<void>;
  acquireLease(strategyId: string, ownerId: string, ttlMs: number, now?: Date): Promise<{ leaseId: string; expiresAt: string }>;
  renewLease(strategyId: string, ownerId: string, ttlMs: number, now?: Date): Promise<{ leaseId: string; expiresAt: string }>;
  releaseLease(strategyId: string, ownerId: string): Promise<void>;
  saveReconciliation(report: BrokerReconciliationReport): Promise<void>;
  close(): Promise<void>;
  health(): { provider: "memory" | "postgres"; transactional: boolean; configured: boolean };
}

type MemorySubmission = {
  fingerprint: string;
  status: "in_flight" | "in_doubt" | "completed";
  reservationId: string;
  result?: SandboxOrderResult;
};

export class InMemoryTransactionalReliabilityRepository implements TransactionalReliabilityRepository {
  private submissions = new Map<string, MemorySubmission>();
  private leases = new Map<string, { leaseId: string; ownerId: string; expiresAt: string }>();
  private reports = new Map<string, BrokerReconciliationReport>();

  async reserveSubmission(key: string, fingerprint: string, reservationId: string): Promise<SubmissionReservation> {
    const existing = this.submissions.get(key);
    if (!existing) {
      this.submissions.set(key, { fingerprint, status: "in_flight", reservationId });
      return { status: "acquired", reservationId };
    }
    if (existing.fingerprint !== fingerprint) return { status: "conflict" };
    if (existing.status === "completed" && existing.result) return { status: "replay", result: existing.result };
    if (existing.status === "in_flight" && existing.reservationId === reservationId) return { status: "acquired", reservationId };
    existing.status = "in_doubt";
    return { status: "in_doubt" };
  }

  async completeSubmission(key: string, reservationId: string, result: SandboxOrderResult) {
    const existing = this.submissions.get(key);
    if (!existing || existing.reservationId !== reservationId) throw new Error("Submission reservation is not owned by this runtime");
    existing.status = "completed";
    existing.result = result;
  }

  async markSubmissionInDoubt(key: string, reservationId: string) {
    const existing = this.submissions.get(key);
    if (existing?.reservationId === reservationId) existing.status = "in_doubt";
  }

  async abandonSubmission(key: string, reservationId: string) {
    if (this.submissions.get(key)?.reservationId === reservationId) this.submissions.delete(key);
  }

  async resolveSubmission(key: string, decision: "record_not_submitted" | "record_broker_result", _reviewedBy: string, result?: SandboxOrderResult) {
    const existing = this.submissions.get(key);
    if (!existing || existing.status !== "in_doubt") throw new Error("Submission is not in doubt");
    if (decision === "record_not_submitted") this.submissions.delete(key);
    else {
      if (!result) throw new Error("Broker result is required");
      existing.status = "completed";
      existing.result = result;
    }
  }

  async acquireLease(strategyId: string, ownerId: string, ttlMs: number, now = new Date()) {
    const existing = this.leases.get(strategyId);
    if (existing && Date.parse(existing.expiresAt) > now.getTime() && existing.ownerId !== ownerId) {
      throw new Error(`Strategy ${strategyId} is leased by another runtime`);
    }
    const lease = {
      leaseId: existing?.ownerId === ownerId ? existing.leaseId : randomUUID(),
      ownerId,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.leases.set(strategyId, lease);
    return { leaseId: lease.leaseId, expiresAt: lease.expiresAt };
  }

  async renewLease(strategyId: string, ownerId: string, ttlMs: number, now = new Date()) {
    const existing = this.leases.get(strategyId);
    if (!existing || existing.ownerId !== ownerId || Date.parse(existing.expiresAt) <= now.getTime()) {
      throw new Error(`Strategy ${strategyId} lease is not owned by this runtime`);
    }
    existing.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    return { leaseId: existing.leaseId, expiresAt: existing.expiresAt };
  }

  async releaseLease(strategyId: string, ownerId: string) {
    if (this.leases.get(strategyId)?.ownerId === ownerId) this.leases.delete(strategyId);
  }

  async saveReconciliation(report: BrokerReconciliationReport) {
    this.reports.set(report.id, report);
  }

  async close() {}

  health() {
    return { provider: "memory" as const, transactional: false, configured: true };
  }
}

export class PgTransactionalReliabilityRepository implements TransactionalReliabilityRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async reserveSubmission(key: string, fingerprint: string, reservationId: string): Promise<SubmissionReservation> {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO execution_submission_idempotency
          (idempotency_key, fingerprint, status, reservation_id)
         VALUES ($1, $2, 'in_flight', $3)
         ON CONFLICT DO NOTHING`,
        [key, fingerprint, reservationId],
      );
      if (inserted.rowCount === 1) return { status: "acquired", reservationId };
      const selected = await client.query(
        `SELECT fingerprint, status, reservation_id, result
         FROM execution_submission_idempotency
         WHERE idempotency_key = $1
         FOR UPDATE`,
        [key],
      );
      const row = selected.rows[0];
      if (!row || row.fingerprint !== fingerprint) return { status: "conflict" };
      if (row.status === "completed" && row.result) return { status: "replay", result: row.result as SandboxOrderResult };
      if (row.status === "in_flight" && row.reservation_id === reservationId) return { status: "acquired", reservationId };
      await client.query(
        `UPDATE execution_submission_idempotency
         SET status = 'in_doubt', updated_at = now()
         WHERE idempotency_key = $1`,
        [key],
      );
      return { status: "in_doubt" };
    });
  }

  async completeSubmission(key: string, reservationId: string, result: SandboxOrderResult) {
    const response = await this.pool.query(
      `UPDATE execution_submission_idempotency
       SET status = 'completed', result = $3::jsonb, updated_at = now()
       WHERE idempotency_key = $1 AND reservation_id = $2`,
      [key, reservationId, JSON.stringify(result)],
    );
    if (response.rowCount !== 1) throw new Error("Submission reservation is not owned by this runtime");
  }

  async markSubmissionInDoubt(key: string, reservationId: string) {
    await this.pool.query(
      `UPDATE execution_submission_idempotency
       SET status = 'in_doubt', updated_at = now()
       WHERE idempotency_key = $1 AND reservation_id = $2`,
      [key, reservationId],
    );
  }

  async abandonSubmission(key: string, reservationId: string) {
    await this.pool.query(
      `DELETE FROM execution_submission_idempotency
       WHERE idempotency_key = $1 AND reservation_id = $2 AND status = 'in_flight'`,
      [key, reservationId],
    );
  }

  async resolveSubmission(key: string, decision: "record_not_submitted" | "record_broker_result", reviewedBy: string, result?: SandboxOrderResult) {
    if (decision === "record_not_submitted") {
      const response = await this.pool.query(
        `DELETE FROM execution_submission_idempotency
         WHERE idempotency_key = $1 AND status = 'in_doubt'`,
        [key],
      );
      if (response.rowCount !== 1) throw new Error("Submission is not in doubt");
      return;
    }
    if (!result) throw new Error("Broker result is required");
    const response = await this.pool.query(
      `UPDATE execution_submission_idempotency
       SET status = 'completed', result = $2::jsonb, reviewed_by = $3, updated_at = now()
       WHERE idempotency_key = $1 AND status = 'in_doubt'`,
      [key, JSON.stringify(result), reviewedBy],
    );
    if (response.rowCount !== 1) throw new Error("Submission is not in doubt");
  }

  async acquireLease(strategyId: string, ownerId: string, ttlMs: number, now = new Date()) {
    const candidateLeaseId = randomUUID();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const response = await this.pool.query(
      `INSERT INTO execution_strategy_leases
        (strategy_id, lease_id, owner_id, acquired_at, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (strategy_id) DO UPDATE
       SET lease_id = CASE
             WHEN execution_strategy_leases.owner_id = EXCLUDED.owner_id
             THEN execution_strategy_leases.lease_id
             ELSE EXCLUDED.lease_id
           END,
           owner_id = EXCLUDED.owner_id,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at,
           updated_at = now()
       WHERE execution_strategy_leases.expires_at <= $4
          OR execution_strategy_leases.owner_id = EXCLUDED.owner_id
       RETURNING lease_id`,
      [strategyId, candidateLeaseId, ownerId, now, expiresAt],
    );
    if (response.rowCount !== 1) throw new Error(`Strategy ${strategyId} is leased by another runtime`);
    return { leaseId: String(response.rows[0].lease_id), expiresAt: expiresAt.toISOString() };
  }

  async renewLease(strategyId: string, ownerId: string, ttlMs: number, now = new Date()) {
    const expiresAt = new Date(now.getTime() + ttlMs);
    const response = await this.pool.query(
      `UPDATE execution_strategy_leases
       SET expires_at = $3, updated_at = now()
       WHERE strategy_id = $1 AND owner_id = $2 AND expires_at > $4
       RETURNING lease_id`,
      [strategyId, ownerId, expiresAt, now],
    );
    if (response.rowCount !== 1) throw new Error(`Strategy ${strategyId} lease is not owned by this runtime`);
    return { leaseId: String(response.rows[0].lease_id), expiresAt: expiresAt.toISOString() };
  }

  async releaseLease(strategyId: string, ownerId: string) {
    await this.pool.query(
      `DELETE FROM execution_strategy_leases WHERE strategy_id = $1 AND owner_id = $2`,
      [strategyId, ownerId],
    );
  }

  async saveReconciliation(report: BrokerReconciliationReport) {
    await this.pool.query(
      `INSERT INTO execution_reconciliation_reports
        (id, provider, status, report, reconciled_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO NOTHING`,
      [report.id, report.provider, report.status, JSON.stringify(report), report.reconciledAt],
    );
  }

  async close() {
    await this.pool.end();
  }

  health() {
    return { provider: "postgres" as const, transactional: true, configured: true };
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createTransactionalReliabilityRepository(env: NodeJS.ProcessEnv = process.env): TransactionalReliabilityRepository {
  return env.DATABASE_URL
    ? new PgTransactionalReliabilityRepository(env.DATABASE_URL)
    : new InMemoryTransactionalReliabilityRepository();
}

export const transactionalReliabilityRepository = createTransactionalReliabilityRepository();
