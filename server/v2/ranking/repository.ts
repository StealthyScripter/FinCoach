import type { StrategyRankingDecision } from "./contracts";

export class InMemoryRankingRepository {
  private readonly rankings = new Map<string, StrategyRankingDecision>();
  save(decision: StrategyRankingDecision) {
    const existing = this.rankings.get(decision.rankingId);
    if (existing) return { inserted: false, record: existing, conflict: fingerprint(existing) === fingerprint(decision) ? "idempotent" as const : "conflicting" as const };
    this.rankings.set(decision.rankingId, decision);
    return { inserted: true, record: decision };
  }
  get(id: string) { return this.rankings.get(id) ?? null; }
  list() { return [...this.rankings.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt) || a.rankingId.localeCompare(b.rankingId)); }
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
