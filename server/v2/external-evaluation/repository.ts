import type { ExternalEvaluation, ReconciledOutcome } from "./contracts";
export class InMemoryExternalEvaluationRepository {
  private readonly evaluations = new Map<string, ExternalEvaluation>();
  private readonly reconciliations = new Map<string, ReconciledOutcome>();
  saveEvaluation(evaluation: ExternalEvaluation) {
    if (this.evaluations.has(evaluation.evaluationId)) return { inserted: false, evaluation: this.evaluations.get(evaluation.evaluationId)! };
    this.evaluations.set(evaluation.evaluationId, evaluation); return { inserted: true, evaluation };
  }
  saveReconciliation(record: ReconciledOutcome) { if (!this.reconciliations.has(record.reconciliationId)) this.reconciliations.set(record.reconciliationId, record); return this.reconciliations.get(record.reconciliationId)!; }
  getEvaluation(id: string) { return this.evaluations.get(id) ?? null; }
  listEvaluations() { return [...this.evaluations.values()].sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.evaluationId.localeCompare(b.evaluationId)); }
}
