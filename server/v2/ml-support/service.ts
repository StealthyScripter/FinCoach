import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { MlErrorCode, MlEvaluationRequest, MlEvidence, MlHealth, MlModelRecord, MlModelRegistration } from "./contracts";
import { MlSupportV2EventTypes } from "./events";
import { InMemoryMlSupportRepository } from "./repository";

type ModelResult = { model: MlModelRecord | null; events: DomainEvent[] };
type EvidenceResult = { evidence: MlEvidence | null; events: DomainEvent[] };

export class MlSupportV2Service {
  constructor(private readonly repository = new InMemoryMlSupportRepository()) {}

  registerModel(request: MlModelRegistration): ModelResult {
    const rejected = validateRegistration(request);
    if (rejected) return this.reject(request.correlationId, request.causationId, rejected, { modelId: request.modelId, modelVersion: request.modelVersion });
    const model: MlModelRecord = { ...request, modelKey: `${request.modelId}:${request.modelVersion}`, schemaVersion: "fincoach.v2.ml-model.1", status: "active" };
    const saved = this.repository.saveModel(model);
    return { model: saved.model, events: [createDomainEvent({ eventType: saved.inserted ? MlSupportV2EventTypes.ModelRegistered : MlSupportV2EventTypes.ModelDuplicateSuppressed, sourceModule: "ml-support", correlationId: request.correlationId, causationId: request.causationId, payload: { modelId: saved.model.modelId, modelVersion: saved.model.modelVersion } })] };
  }

  evaluate(request: MlEvaluationRequest): EvidenceResult {
    const model = this.repository.getModel(request.modelId, request.modelVersion);
    if (!model) return this.rejectEvidence(request, "model_unavailable");
    if (model.status !== "active") return this.rejectEvidence(request, "stale_model");
    const requestedFeatures = Object.keys(request.features).sort();
    if (requestedFeatures.join("|") !== [...model.features].sort().join("|")) return this.rejectEvidence(request, "feature_mismatch");
    const normalized = Object.fromEntries(requestedFeatures.map(key => [key, request.features[key]]));
    const score = requestedFeatures.reduce((sum, key, index) => sum + request.features[key] * (index + 1), 0);
    const evidenceId = createHash("sha256").update(JSON.stringify({ model: model.modelKey, observationId: request.observationId, features: normalized })).digest("hex").slice(0, 32);
    const evidence = this.repository.saveEvidence({
      evidenceId,
      schemaVersion: "fincoach.v2.ml-evidence.1",
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      observationId: request.observationId,
      purpose: model.purpose,
      prediction: score >= requestedFeatures.length / 2 ? "supportive" : "caution",
      confidence: Number(Math.min(0.99, Math.max(0.01, 0.5 + score / 10)).toFixed(4)),
      features: normalized,
      decisionAuthority: "none",
      createdAt: request.observedAt,
      lineageEventIds: [...model.trainingLineageEventIds, model.modelKey],
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
    return { evidence, events: [createDomainEvent({ eventType: MlSupportV2EventTypes.MlEvidenceCreated, sourceModule: "ml-support", correlationId: request.correlationId, causationId: request.causationId, payload: { evidenceId: evidence.evidenceId, modelId: model.modelId } })] };
  }

  detectDrift(modelId: string, modelVersion: string, drift: { populationStabilityIndex: number }, correlationId: string, causationId: string | null) {
    const model = this.repository.getModel(modelId, modelVersion);
    if (model && drift.populationStabilityIndex >= 0.25) this.repository.updateModel({ ...model, status: "stale" });
    return { events: [createDomainEvent({ eventType: MlSupportV2EventTypes.ModelDriftDetected, sourceModule: "ml-support", correlationId, causationId, payload: { modelId, modelVersion, ...drift } })] };
  }

  rollback(modelId: string, modelVersion: string, reason: string, correlationId: string, causationId: string | null) {
    const model = this.repository.getModel(modelId, modelVersion);
    if (model) this.repository.updateModel({ ...model, status: "rolled_back" });
    return { events: [createDomainEvent({ eventType: MlSupportV2EventTypes.ModelRolledBack, sourceModule: "ml-support", correlationId, causationId, payload: { modelId, modelVersion, reason } })] };
  }

  getModel(modelId: string, modelVersion: string) {
    return this.repository.getModel(modelId, modelVersion);
  }

  health(checkedAt = new Date().toISOString()): MlHealth {
    return { module: "ml-support", status: "healthy", schemaVersion: "fincoach.v2.ml-model.1", checkedAt, modelCount: this.repository.listModels().length, evidenceCount: this.repository.listEvidence().length };
  }

  private reject(correlationId: string, causationId: string | null, reason: MlErrorCode, payload: Record<string, unknown>): ModelResult {
    return { model: null, events: [createDomainEvent({ eventType: MlSupportV2EventTypes.ModelRejected, sourceModule: "ml-support", correlationId, causationId, payload: { ...payload, reason } })] };
  }

  private rejectEvidence(request: MlEvaluationRequest, reason: MlErrorCode): EvidenceResult {
    return { evidence: null, events: [createDomainEvent({ eventType: MlSupportV2EventTypes.ModelRejected, sourceModule: "ml-support", correlationId: request.correlationId, causationId: request.causationId, payload: { reason, modelId: request.modelId, modelVersion: request.modelVersion, observationId: request.observationId } })] };
  }
}

function validateRegistration(request: MlModelRegistration): MlErrorCode | null {
  if (!request.modelId || !request.modelVersion || !request.createdAt || !request.correlationId) return "missing_required_field";
  if (!request.trainingLineageEventIds.length) return "missing_training_lineage";
  if (!(Date.parse(request.trainWindow.end) < Date.parse(request.validationWindow.start) && Date.parse(request.validationWindow.end) < Date.parse(request.testWindow.start))) return "temporal_leakage";
  const calibrationScore = Number(request.calibration.score);
  if (!Number.isFinite(calibrationScore) || calibrationScore < 0.5) return "calibration_failed";
  return null;
}

export const mlSupportV2Service = new MlSupportV2Service();
