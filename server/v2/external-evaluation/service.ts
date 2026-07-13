import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ExternalEvaluation, ExternalEvaluationInput, ExternalEvaluationOutcome, ReconciledOutcome } from "./contracts";
import { ExternalEvaluationV2EventTypes } from "./events";
import { InMemoryExternalEvaluationRepository } from "./repository";

export class ExternalEvaluationV2Service {
  constructor(private readonly repository = new InMemoryExternalEvaluationRepository()) {}
  receive(input: ExternalEvaluationInput): { evaluation: ExternalEvaluation | null; events: DomainEvent[] } {
    const reason = validate(input);
    if (reason) return { evaluation: null, events: [createDomainEvent({ eventType: ExternalEvaluationV2EventTypes.ExternalEvaluationRejected, sourceModule: "external-evaluation", correlationId: input.correlationId, causationId: input.causationId, payload: { reason } })] };
    const evaluation: ExternalEvaluation = { ...input, schemaVersion: "fincoach.v2.external-evaluation.1" };
    const saved = this.repository.saveEvaluation(evaluation);
    return { evaluation: saved.evaluation, events: [createDomainEvent({ eventType: saved.inserted ? ExternalEvaluationV2EventTypes.ExternalEvaluationReceived : ExternalEvaluationV2EventTypes.ExternalEvaluationDuplicateSuppressed, sourceModule: "external-evaluation", correlationId: input.correlationId, causationId: input.causationId, payload: { evaluationId: input.evaluationId, signalId: input.signalId } })] };
  }
  reconcile(signalId: string, internalOutcome: ExternalEvaluationOutcome, evaluations: ExternalEvaluation[], correlationId: string, causationId: string | null): { reconciliation: ReconciledOutcome; events: DomainEvent[] } {
    if (!evaluations.length) throw new Error("missing external evaluation");
    const externalOutcome = evaluations[0].outcome;
    const reconciliation: ReconciledOutcome = { reconciliationId: createHash("sha256").update(JSON.stringify({ signalId, internalOutcome, evaluationIds: evaluations.map(e => e.evaluationId).sort() })).digest("hex").slice(0, 32), signalId, evaluationIds: evaluations.map(e => e.evaluationId), internalOutcome, externalOutcome, disagreement: internalOutcome !== externalOutcome, createdAt: new Date().toISOString(), lineageEventIds: evaluations.flatMap(e => e.lineageEventIds), correlationId, causationId };
    this.repository.saveReconciliation(reconciliation);
    return { reconciliation, events: [createDomainEvent({ eventType: ExternalEvaluationV2EventTypes.SignalOutcomeReconciled, sourceModule: "external-evaluation", correlationId, causationId, payload: { reconciliationId: reconciliation.reconciliationId } }), ...(reconciliation.disagreement ? [createDomainEvent({ eventType: ExternalEvaluationV2EventTypes.EvaluationDisagreementDetected, sourceModule: "external-evaluation", correlationId, causationId, payload: { signalId, internalOutcome, externalOutcome } })] : [])] };
  }
}
function validate(input: ExternalEvaluationInput): string | null {
  if (!input.signalId || !input.evaluationId || !input.evaluatorVersion) return "missing_required_field";
  if (!input.lineageEventIds.length) return "missing_lineage";
  if (![input.r, input.profitLoss, input.mfe, input.mae, input.holdingDurationMinutes].every(Number.isFinite)) return "invalid_numeric_field";
  if (input.holdingDurationMinutes < 0) return "invalid_duration";
  if (input.outcome === "tp" && !input.tpReached) return "outcome_conflict";
  if (input.outcome === "sl" && !input.slReached) return "outcome_conflict";
  return null;
}
export const externalEvaluationV2Service = new ExternalEvaluationV2Service();
