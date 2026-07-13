import type { ResearchExperiment } from "./contracts";
export class InMemoryExperimentRepository {
  private experiments = new Map<string, ResearchExperiment>(); private fingerprints = new Map<string, string>();
  save(exp: ResearchExperiment) { const existing = this.fingerprints.get(exp.fingerprint); if (existing) return { inserted: false, existing: this.experiments.get(existing)! }; this.experiments.set(exp.experimentId, clone(exp)); this.fingerprints.set(exp.fingerprint, exp.experimentId); return { inserted: true, existing: null }; }
  update(exp: ResearchExperiment) { if (!this.experiments.has(exp.experimentId)) throw new Error("experiment missing"); this.experiments.set(exp.experimentId, clone(exp)); return exp; }
  list() { return Array.from(this.experiments.values()).map(clone).sort((a,b)=>b.priority-a.priority || a.createdAt.localeCompare(b.createdAt)); }
  get(id: string) { const found = this.experiments.get(id); return found ? clone(found) : null; }
}
function clone(e: ResearchExperiment): ResearchExperiment { return JSON.parse(JSON.stringify(e)); }
