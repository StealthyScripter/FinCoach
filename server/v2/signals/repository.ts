import type { V2ResearchSignal } from "./contracts";
import { evaluateSignalForEvaluationEligibility } from "../runtime/postSignalEligibility";
export class InMemorySignalRepository {
  private readonly signals = new Map<string, V2ResearchSignal>();
  save(signal: V2ResearchSignal) {
    const existing = this.signals.get(signal.signalId);
    if (existing) return { inserted: false, signal: existing, record: existing, conflict: fingerprint(existing) === fingerprint(signal) ? "idempotent" as const : "conflicting" as const };
    this.signals.set(signal.signalId, signal); return { inserted: true, signal, record: signal };
  }
  get(id: string) { return this.signals.get(id) ?? null; }
  list() { return [...this.signals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.signalId.localeCompare(b.signalId)); }
  async eligibleForEvaluation(input: { now: Date; limit: number }) {
    return this.list().filter(signal => evaluateSignalForEvaluationEligibility(signal, input.now).eligible).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.signalId.localeCompare(b.signalId)).slice(0, input.limit);
  }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; symbol?: string } = {}) {
    const filtered = this.list().filter(signal => (!input.strategyId || signal.strategyId === input.strategyId) && (!input.symbol || signal.symbol === input.symbol));
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }
  countActive(at: Date) {
    return this.list().filter(signal => Date.parse(signal.validUntil) > at.getTime()).length;
  }
  health() {
    return { availability: this.signals.size > 0 ? "available" : "available_empty", total: this.signals.size };
  }
}

function fingerprint(value: unknown) {
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
