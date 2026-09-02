import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ExternalEvaluation, ReconciledOutcome } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgExternalEvaluationRepository {
  private readonly evaluations: PgEvidenceRepository<ExternalEvaluation>;
  private readonly reconciliations = new Map<string, ReconciledOutcome>();
  constructor(private readonly db: Queryable) {
    this.evaluations = new PgEvidenceRepository(db, {
      tableName: "v2_external_evaluations",
      schemaVersion: "fincoach.v2.external-evaluation.1",
      sourceModule: "external-evaluation",
      idOf: record => record.evaluationId,
      naturalKeyOf: record => record.evaluationId,
      idempotencyKeyOf: record => record.evaluationId,
      createdAtOf: record => record.evaluatedAt,
    });
  }
  saveEvaluation(evaluation: ExternalEvaluation) { return this.evaluations.save(evaluation).then(result => ({ inserted: result.inserted, evaluation: result.record, record: result.record, conflict: result.conflict })); }
  saveReconciliation(record: ReconciledOutcome) { if (!this.reconciliations.has(record.reconciliationId)) this.reconciliations.set(record.reconciliationId, record); return this.reconciliations.get(record.reconciliationId)!; }
  getEvaluation(id: string) { return this.evaluations.get(id); }
  async getForSignal(signalId: string) {
    const result = await this.db.query("SELECT payload FROM v2_external_evaluations WHERE payload->>'signalId' = $1 ORDER BY created_at ASC, record_id ASC LIMIT 1", [signalId]);
    return (result.rows[0]?.payload as ExternalEvaluation | undefined) ?? null;
  }
  async hasForSignal(signalId: string) {
    const result = await this.db.query("SELECT 1 FROM v2_external_evaluations WHERE payload->>'signalId' = $1 LIMIT 1", [signalId]);
    return Boolean(result.rowCount);
  }
  async listEvaluations(input: { limit?: number; offset?: number } = {}) { return (await this.evaluations.list(input)).items; }
  async eligibleForJournal(input: { limit: number }) {
    const result = await this.db.query(
      `SELECT payload FROM v2_external_evaluations
       WHERE payload->>'outcome' IN ('tp', 'sl', 'expired', 'cancelled')
         AND jsonb_array_length(lineage_event_ids) > 0
       ORDER BY created_at DESC, record_id ASC
       LIMIT $1`,
      [input.limit],
    );
    return result.rows.map((row: { payload: ExternalEvaluation }) => row.payload);
  }
  listPage(input: { limit?: number; offset?: number } = {}) { return this.evaluations.list(input); }
  health() { return this.evaluations.health(); }
}
