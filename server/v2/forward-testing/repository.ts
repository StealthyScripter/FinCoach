import type { ForwardTestRecord } from "./contracts";
import { evaluateSignalEligibility } from "../signals/eligibility";
import { createHash } from "node:crypto";

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
    const superseded = new Set(this.list().map(record => record.supersedesId).filter((id): id is string => Boolean(id)));
    return this.list()
      .filter(record => !superseded.has(record.forwardTestId) && evaluateSignalEligibility(record, { now: input.now }).eligible)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.forwardTestId.localeCompare(b.forwardTestId))
      .slice(0, input.limit);
  }
  listPage(input: { limit?: number; offset?: number; strategyId?: string; status?: string } = {}) {
    const filtered = this.list().filter(record => (!input.strategyId || record.strategyId === input.strategyId) && (!input.status || record.status === input.status));
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }
  countActive() {
    const superseded = new Set(this.list().map(record => record.supersedesId).filter((id): id is string => Boolean(id)));
    return this.list().filter(record => record.status === "monitoring" && !superseded.has(record.forwardTestId)).length;
  }
  complete(forwardTestId: string, evaluationId: string, completedAt: Date) {
    const source = this.records.get(forwardTestId);
    if (!source || source.status !== "monitoring") return { inserted: false, record: source ?? null };
    const terminalId = createHash("sha256").update(`${forwardTestId}:completed:${evaluationId}`).digest("hex").slice(0, 32);
    const existing = this.records.get(terminalId);
    if (existing) return { inserted: false, record: existing };
    const record: ForwardTestRecord = { ...source, forwardTestId: terminalId, status: "completed", reason: "authoritative signal evaluation finalized", ruleEvaluation: { ...source.ruleEvaluation, finalEvaluationId: evaluationId }, createdAt: completedAt.toISOString(), lineageEventIds: [...new Set([...source.lineageEventIds, forwardTestId, evaluationId])], causationId: evaluationId, supersedesId: forwardTestId };
    this.records.set(terminalId, record);
    return { inserted: true, record };
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
