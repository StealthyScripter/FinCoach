import type { FeatureEngineeringRepository, FeatureVector } from "./contracts";

export class InMemoryFeatureEngineeringRepository implements FeatureEngineeringRepository {
  private readonly vectors = new Map<string, FeatureVector>();

  async save(vector: FeatureVector) {
    const existing = this.vectors.get(vector.vectorId);
    if (existing) return { inserted: false, existing };
    this.vectors.set(vector.vectorId, clone(vector));
    return { inserted: true };
  }

  async findById(vectorId: string) {
    const found = this.vectors.get(vectorId);
    return found ? clone(found) : null;
  }
}

function clone(vector: FeatureVector): FeatureVector {
  return { ...vector, inputEventIds: [...vector.inputEventIds], inputRange: { ...vector.inputRange }, features: vector.features.map((feature) => ({ ...feature })) };
}
