import type { V2ResearchSignal } from "./contracts";
export class InMemorySignalRepository {
  private readonly signals = new Map<string, V2ResearchSignal>();
  save(signal: V2ResearchSignal) {
    if (this.signals.has(signal.signalId)) return { inserted: false, signal: this.signals.get(signal.signalId)! };
    this.signals.set(signal.signalId, signal); return { inserted: true, signal };
  }
  get(id: string) { return this.signals.get(id) ?? null; }
  list() { return [...this.signals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.signalId.localeCompare(b.signalId)); }
}
