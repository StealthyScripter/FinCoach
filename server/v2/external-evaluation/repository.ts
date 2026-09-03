import type { ExternalEvaluation, ReconciledOutcome } from "./contracts";
import { evaluateEvaluationForJournalEligibility } from "../runtime/postSignalEligibility";
export class InMemoryExternalEvaluationRepository {
  private readonly evaluations = new Map<string, ExternalEvaluation>();
  private readonly reconciliations = new Map<string, ReconciledOutcome>();
  saveEvaluation(evaluation: ExternalEvaluation) {
    const existing = this.evaluations.get(evaluation.evaluationId);
    if (existing) return { inserted: false, evaluation: existing, record: existing, conflict: fingerprint(existing) === fingerprint(evaluation) ? "idempotent" as const : "conflicting" as const };
    this.evaluations.set(evaluation.evaluationId, evaluation); return { inserted: true, evaluation, record: evaluation };
  }
  saveReconciliation(record: ReconciledOutcome) { if (!this.reconciliations.has(record.reconciliationId)) this.reconciliations.set(record.reconciliationId, record); return this.reconciliations.get(record.reconciliationId)!; }
  getEvaluation(id: string) { return this.evaluations.get(id) ?? null; }
  getForSignal(signalId: string) { return this.listEvaluations().sort((a, b) => Number(b.evaluationSource === "oanda_practice") - Number(a.evaluationSource === "oanda_practice")).find(evaluation => evaluation.signalId === signalId) ?? null; }
  hasForSignal(signalId: string) { return this.listEvaluations().some(evaluation => evaluation.signalId === signalId); }
  listEvaluations() { return [...this.evaluations.values()].sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.evaluationId.localeCompare(b.evaluationId)); }
  async eligibleForJournal(input: { limit: number }) {
    return this.listEvaluations().filter(evaluation => evaluateEvaluationForJournalEligibility(evaluation).eligible).sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt) || a.evaluationId.localeCompare(b.evaluationId)).slice(0, input.limit);
  }
}

function fingerprint(value: unknown) { return JSON.stringify(value); }
