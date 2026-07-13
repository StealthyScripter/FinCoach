import type { MlEvidence, MlModelRecord } from "./contracts";

export class InMemoryMlSupportRepository {
  private readonly models = new Map<string, MlModelRecord>();
  private readonly evidence = new Map<string, MlEvidence>();

  constructor(seed: { models?: readonly MlModelRecord[]; evidence?: readonly MlEvidence[] } = {}) {
    for (const model of seed.models ?? []) this.models.set(model.modelKey, freezeRecord(model));
    for (const item of seed.evidence ?? []) this.evidence.set(item.evidenceId, freezeRecord(item));
  }

  saveModel(model: MlModelRecord) {
    const existing = this.models.get(model.modelKey);
    if (existing) return { inserted: false, model: existing };
    const frozen = freezeRecord(model);
    this.models.set(frozen.modelKey, frozen);
    return { inserted: true, model: frozen };
  }

  updateModel(model: MlModelRecord) {
    const frozen = freezeRecord(model);
    this.models.set(frozen.modelKey, frozen);
    return frozen;
  }

  getModel(modelId: string, modelVersion: string) {
    return this.models.get(`${modelId}:${modelVersion}`) ?? null;
  }

  saveEvidence(evidence: MlEvidence) {
    const existing = this.evidence.get(evidence.evidenceId);
    if (existing) return existing;
    const frozen = freezeRecord(evidence);
    this.evidence.set(frozen.evidenceId, frozen);
    return frozen;
  }

  listModels() {
    return [...this.models.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.modelKey.localeCompare(b.modelKey));
  }

  listEvidence() {
    return [...this.evidence.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.evidenceId.localeCompare(b.evidenceId));
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
