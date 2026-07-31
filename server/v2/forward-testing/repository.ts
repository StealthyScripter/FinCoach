import type { ForwardTestRecord } from "./contracts";
import { evaluateSignalEligibility } from "../signals/eligibility";

export type EligibleForwardTestsForSignalQuery = {
  now: Date;
  limit: number;
};

export class InMemoryForwardTestingRepository {
  private readonly records = new Map<string, ForwardTestRecord>();
  save(record: ForwardTestRecord) {
    const existing = this.records.get(record.forwardTestId);
    if (existing) return { inserted: false, record: existing, conflict: fingerprint(existing) === fingerprint(record) ? "idempotent" as const : "conflicting" as const };
    this.records.set(record.forwardTestId, record);
    return { inserted: true, record };
  }
  get(id: string) { return this.records.get(id) ?? null; }
  list() { return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.forwardTestId.localeCompare(b.forwardTestId)); }
  async eligibleForSignal(input: EligibleForwardTestsForSignalQuery) {
    void input.now;
    return this.list()
      .filter(record => evaluateSignalEligibility(record, { now: input.now }).eligible)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.forwardTestId.localeCompare(b.forwardTestId))
      .slice(0, input.limit);
  }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) {
    const filtered = this.list().filter(record => (!input.strategyId || record.strategyId === input.strategyId) && (!input.status || record.status === input.status));
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }
  health() {
    return { availability: this.records.size > 0 ? "available" : "available_empty", total: this.records.size };
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
