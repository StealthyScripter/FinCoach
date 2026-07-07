import type { DetectedPattern } from "./contracts";

export class PatternDiscoveryRepository {
  private readonly patterns: DetectedPattern[] = [];

  save(pattern: DetectedPattern) {
    this.patterns.push({ ...pattern, sourceEventRefs: [...pattern.sourceEventRefs] });
    return pattern;
  }

  list() {
    return this.patterns.map((pattern) => ({ ...pattern, sourceEventRefs: [...pattern.sourceEventRefs] }));
  }
}
