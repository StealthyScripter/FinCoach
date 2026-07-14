import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ExternalEvaluation, ReconciledOutcome } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgExternalEvaluationRepository {
  private readonly evaluations: PgEvidenceRepository<ExternalEvaluation>;
  private readonly reconciliations = new Map<string, ReconciledOutcome>();
  constructor(db: Queryable) {
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
  saveEvaluation(evaluation: ExternalEvaluation) { return this.evaluations.save(evaluation).then(result => ({ inserted: result.inserted, evaluation: result.record, conflict: result.conflict })); }
  saveReconciliation(record: ReconciledOutcome) { if (!this.reconciliations.has(record.reconciliationId)) this.reconciliations.set(record.reconciliationId, record); return this.reconciliations.get(record.reconciliationId)!; }
  getEvaluation(id: string) { return this.evaluations.get(id); }
  async listEvaluations(input: { limit?: number; offset?: number } = {}) { return (await this.evaluations.list(input)).items; }
  listPage(input: { limit?: number; offset?: number } = {}) { return this.evaluations.list(input); }
  health() { return this.evaluations.health(); }
}
