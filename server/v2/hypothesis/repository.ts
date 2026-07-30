import type { ResearchHypothesis } from "./contracts";

export class InMemoryHypothesisRepository {
  private byId = new Map<string, ResearchHypothesis>();
  private byFingerprint = new Map<string, string>();
  save(hypothesis: ResearchHypothesis) {
    const existing = this.byFingerprint.get(hypothesis.fingerprint);
    if (existing) {
      const record = clone(this.byId.get(existing)!);
      return { inserted: false, existing: record, record, hypothesis: record, conflict: "idempotent" as const };
    }
    this.byId.set(hypothesis.hypothesisId, clone(hypothesis));
    this.byFingerprint.set(hypothesis.fingerprint, hypothesis.hypothesisId);
    return { inserted: true, existing: null, record: clone(hypothesis), hypothesis: clone(hypothesis), conflict: undefined };
  }
  list() { return Array.from(this.byId.values()).map(clone); }
  get(id: string) { const found = this.byId.get(id); return found ? clone(found) : null; }
}
function clone(h: ResearchHypothesis): ResearchHypothesis { return JSON.parse(JSON.stringify(h)); }
