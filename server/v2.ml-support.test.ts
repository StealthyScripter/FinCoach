import assert from "node:assert/strict";
import { MlSupportV2EventTypes, MlSupportV2Service } from "./v2/ml-support";

const correlationId = "00000000-0000-4000-8000-000000000020";

const trainingRequest = {
  modelId: "regime-classifier",
  modelVersion: "2026.01.01",
  purpose: "regime_classification" as const,
  trainingLineageEventIds: ["lesson-event-1", "journal-event-1"],
  features: ["volatility", "trend"],
  trainWindow: { start: "2025-01-01T00:00:00.000Z", end: "2025-09-01T00:00:00.000Z" },
  validationWindow: { start: "2025-09-02T00:00:00.000Z", end: "2025-11-01T00:00:00.000Z" },
  testWindow: { start: "2025-11-02T00:00:00.000Z", end: "2025-12-01T00:00:00.000Z" },
  calibration: { method: "isotonic", score: 0.91 },
  metrics: { accuracy: 0.72, brierScore: 0.18 },
  modelCard: { owner: "research", limitations: ["demo evidence"], intendedUse: "decision support" },
  createdAt: "2026-01-01T00:00:00.000Z",
  correlationId,
  causationId: null,
};

const service = new MlSupportV2Service();
const registered = service.registerModel(trainingRequest);
assert.equal(registered.model?.schemaVersion, "fincoach.v2.ml-model.1");
assert.equal(registered.events[0].eventType, MlSupportV2EventTypes.ModelRegistered);

const duplicate = service.registerModel(trainingRequest);
assert.equal(duplicate.events[0].eventType, MlSupportV2EventTypes.ModelDuplicateSuppressed);

const leakage = service.registerModel({
  ...trainingRequest,
  modelVersion: "leaky",
  validationWindow: { start: "2025-08-01T00:00:00.000Z", end: "2025-10-01T00:00:00.000Z" },
});
assert.equal(leakage.model, null);
assert.equal(leakage.events[0].payload.reason, "temporal_leakage");

const prediction = service.evaluate({
  modelId: "regime-classifier",
  modelVersion: "2026.01.01",
  observationId: "obs-1",
  features: { volatility: 0.4, trend: 0.8 },
  observedAt: "2026-01-02T00:00:00.000Z",
  correlationId,
  causationId: registered.events[0].eventId,
});
assert.equal(prediction.evidence?.schemaVersion, "fincoach.v2.ml-evidence.1");
assert.equal(prediction.evidence?.decisionAuthority, "none");
assert.equal(prediction.events[0].eventType, MlSupportV2EventTypes.MlEvidenceCreated);

const replay = service.evaluate({
  modelId: "regime-classifier",
  modelVersion: "2026.01.01",
  observationId: "obs-1",
  features: { trend: 0.8, volatility: 0.4 },
  observedAt: "2026-01-02T00:00:00.000Z",
  correlationId,
  causationId: registered.events[0].eventId,
});
assert.deepEqual(replay.evidence, prediction.evidence);

assert.equal(service.evaluate({
  modelId: "regime-classifier",
  modelVersion: "2026.01.01",
  observationId: "obs-2",
  features: { volatility: 0.4 },
  observedAt: "2026-01-02T00:00:00.000Z",
  correlationId,
  causationId: null,
}).events[0].payload.reason, "feature_mismatch");

assert.equal(service.evaluate({
  modelId: "missing",
  modelVersion: "none",
  observationId: "obs-3",
  features: { volatility: 0.4, trend: 0.8 },
  observedAt: "2026-01-02T00:00:00.000Z",
  correlationId,
  causationId: null,
}).events[0].payload.reason, "model_unavailable");

const drift = service.detectDrift("regime-classifier", "2026.01.01", { populationStabilityIndex: 0.41 }, correlationId, null);
assert.equal(drift.events[0].eventType, MlSupportV2EventTypes.ModelDriftDetected);
assert.equal(service.getModel("regime-classifier", "2026.01.01")?.status, "stale");

const stale = service.evaluate({
  modelId: "regime-classifier",
  modelVersion: "2026.01.01",
  observationId: "obs-4",
  features: { volatility: 0.4, trend: 0.8 },
  observedAt: "2026-01-03T00:00:00.000Z",
  correlationId,
  causationId: null,
});
assert.equal(stale.evidence, null);
assert.equal(stale.events[0].payload.reason, "stale_model");

const rollback = service.rollback("regime-classifier", "2026.01.01", "drift threshold exceeded", correlationId, null);
assert.equal(rollback.events[0].eventType, MlSupportV2EventTypes.ModelRolledBack);
assert.equal(service.getModel("regime-classifier", "2026.01.01")?.status, "rolled_back");
assert.equal("authorizeExecution" in service || "promoteStrategy" in service || "overrideGovernance" in service, false);

console.log("v2 phase 20 ml-support tests passed");
