import { Pool } from "pg";

export type GovernanceApprovalRecord = {
  id: string;
  requestedBy: string;
  justification: string;
  status: string;
  scope: unknown;
  reviews: unknown;
  requestedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revocationReason?: string | null;
};

export type GovernanceAuditExportRecord = {
  id: string;
  artifactDigest: string;
  previousArtifactDigest: string | null;
  signature: string | null;
  signatureAlgorithm: string;
  eventCount: number;
  auditEntryCount: number;
  storageLocation: string | null;
  archiveLocation: string | null;
  generatedBy: string;
  generatedAt: string;
};

export type GovernanceExecutionAuditRecord = {
  id: string;
  action: string;
  outcome: string;
  correlationId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export interface GovernanceRepository {
  saveApproval(approval: GovernanceApprovalRecord): Promise<void>;
  mutateApproval<T extends GovernanceApprovalRecord>(
    id: string,
    mutate: (approval: GovernanceApprovalRecord) => T,
  ): Promise<T>;
  getApproval<T>(id: string): Promise<T | null>;
  listApprovals<T>(): Promise<T[]>;
  saveAuditExport(record: GovernanceAuditExportRecord): Promise<void>;
  listAuditExports<T>(): Promise<T[]>;
  saveExecutionAudit(record: GovernanceExecutionAuditRecord): Promise<void>;
  listExecutionAudits(): Promise<GovernanceExecutionAuditRecord[]>;
  health(): { provider: "memory" | "postgres"; durable: boolean };
  close(): Promise<void>;
}

export class InMemoryGovernanceRepository implements GovernanceRepository {
  private approvals = new Map<string, unknown>();
  private exports = new Map<string, unknown>();
  private executionAudits = new Map<string, GovernanceExecutionAuditRecord>();

  async saveApproval(approval: GovernanceApprovalRecord) {
    this.approvals.set(approval.id, structuredClone(approval));
  }
  async getApproval<T>(id: string) {
    return (structuredClone(this.approvals.get(id)) as T | undefined) ?? null;
  }
  async mutateApproval<T extends GovernanceApprovalRecord>(
    id: string,
    mutate: (approval: GovernanceApprovalRecord) => T,
  ) {
    const existing = this.approvals.get(id);
    if (!existing) throw new Error("Semi-autonomous approval not found");
    const mutated = mutate(structuredClone(existing) as GovernanceApprovalRecord);
    this.approvals.set(id, structuredClone(mutated));
    return structuredClone(mutated);
  }
  async listApprovals<T>() {
    return Array.from(this.approvals.values()).map((item) => structuredClone(item) as T);
  }
  async saveAuditExport(record: GovernanceAuditExportRecord) {
    this.exports.set(record.id, structuredClone(record));
  }
  async listAuditExports<T>() {
    return Array.from(this.exports.values()).map((item) => structuredClone(item) as T);
  }
  async saveExecutionAudit(record: GovernanceExecutionAuditRecord) {
    this.executionAudits.set(record.id, structuredClone(record));
  }
  async listExecutionAudits() {
    return Array.from(this.executionAudits.values()).map((item) => structuredClone(item));
  }
  health() { return { provider: "memory" as const, durable: false }; }
  async close() {}
}

export class PgGovernanceRepository implements GovernanceRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async saveApproval(approval: GovernanceApprovalRecord) {
    await this.pool.query(
      `INSERT INTO semi_autonomous_approvals
        (id, requested_by, justification, status, scope, reviews, requested_at, expires_at, revoked_at, revoked_by, revocation_reason, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, now())
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           justification = EXCLUDED.justification,
           scope = EXCLUDED.scope,
           reviews = EXCLUDED.reviews,
           expires_at = EXCLUDED.expires_at,
           revoked_at = EXCLUDED.revoked_at,
           revoked_by = EXCLUDED.revoked_by,
           revocation_reason = EXCLUDED.revocation_reason,
           updated_at = now()`,
      [
        approval.id, approval.requestedBy, approval.justification, approval.status,
        JSON.stringify(approval.scope), JSON.stringify(approval.reviews),
        approval.requestedAt, approval.expiresAt,
        approval.revokedAt ?? null, approval.revokedBy ?? null, approval.revocationReason ?? null,
      ],
    );
  }

  async mutateApproval<T extends GovernanceApprovalRecord>(
    id: string,
    mutate: (approval: GovernanceApprovalRecord) => T,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(`SELECT * FROM semi_autonomous_approvals WHERE id = $1 FOR UPDATE`, [id]);
      if (!selected.rows[0]) throw new Error("Semi-autonomous approval not found");
      const mutated = mutate(mapApproval(selected.rows[0]));
      await client.query(
        `UPDATE semi_autonomous_approvals
         SET status = $2,
             justification = $3,
             scope = $4::jsonb,
             reviews = $5::jsonb,
             expires_at = $6,
             revoked_at = $7,
             revoked_by = $8,
             revocation_reason = $9,
             updated_at = now()
         WHERE id = $1`,
        [
          id, mutated.status, mutated.justification, JSON.stringify(mutated.scope),
          JSON.stringify(mutated.reviews), mutated.expiresAt,
          mutated.revokedAt ?? null, mutated.revokedBy ?? null, mutated.revocationReason ?? null,
        ],
      );
      await client.query("COMMIT");
      return mutated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getApproval<T>(id: string) {
    const response = await this.pool.query(`SELECT * FROM semi_autonomous_approvals WHERE id = $1`, [id]);
    return response.rows[0] ? mapApproval(response.rows[0]) as T : null;
  }

  async listApprovals<T>() {
    const response = await this.pool.query(`SELECT * FROM semi_autonomous_approvals ORDER BY requested_at DESC`);
    return response.rows.map(mapApproval) as T[];
  }

  async saveAuditExport(record: GovernanceAuditExportRecord) {
    await this.pool.query(
      `INSERT INTO execution_audit_exports
        (id, artifact_digest, previous_artifact_digest, signature, signature_algorithm,
         event_count, audit_entry_count, storage_location, archive_location, generated_by, generated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id, record.artifactDigest, record.previousArtifactDigest, record.signature,
        record.signatureAlgorithm, record.eventCount, record.auditEntryCount,
        record.storageLocation, record.archiveLocation, record.generatedBy, record.generatedAt,
        JSON.stringify({ productionOrderSubmissionEnabled: false }),
      ],
    );
  }

  async listAuditExports<T>() {
    const response = await this.pool.query(`SELECT * FROM execution_audit_exports ORDER BY generated_at DESC`);
    return response.rows.map((row) => ({
      id: row.id,
      artifactDigest: row.artifact_digest,
      previousArtifactDigest: row.previous_artifact_digest,
      signature: row.signature,
      signatureAlgorithm: row.signature_algorithm,
      eventCount: row.event_count,
      auditEntryCount: row.audit_entry_count,
      storageLocation: row.storage_location,
      archiveLocation: row.archive_location,
      generatedBy: row.generated_by,
      generatedAt: new Date(row.generated_at).toISOString(),
    })) as T[];
  }

  async saveExecutionAudit(record: GovernanceExecutionAuditRecord) {
    await this.pool.query(
      `INSERT INTO execution_audit_entries
        (id, action, outcome, correlation_id, detail, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.action, record.outcome, record.correlationId, JSON.stringify(record.detail), record.createdAt],
    );
  }

  async listExecutionAudits() {
    const response = await this.pool.query(`SELECT * FROM execution_audit_entries ORDER BY created_at DESC LIMIT 100000`);
    return response.rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      outcome: String(row.outcome),
      correlationId: String(row.correlation_id),
      detail: row.detail as Record<string, unknown>,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  health() { return { provider: "postgres" as const, durable: true }; }
  async close() { await this.pool.end(); }
}

function mapApproval(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    requestedBy: String(row.requested_by),
    justification: String(row.justification),
    status: String(row.status),
    scope: row.scope,
    reviews: row.reviews,
    requestedAt: new Date(String(row.requested_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    revokedBy: row.revoked_by ? String(row.revoked_by) : null,
    revocationReason: row.revocation_reason ? String(row.revocation_reason) : null,
    automaticallyApplied: false,
    productionOrderSubmissionEnabled: false,
  };
}

export function createGovernanceRepository(env: NodeJS.ProcessEnv = process.env): GovernanceRepository {
  return env.DATABASE_URL ? new PgGovernanceRepository(env.DATABASE_URL) : new InMemoryGovernanceRepository();
}

export const governanceRepository = createGovernanceRepository();
