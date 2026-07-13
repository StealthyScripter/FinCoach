import { createDomainEvent, type DomainEvent } from "../contracts";
import type { HistoricalSimilarityResult, MarketStateVector, SearchInput, VectorInput } from "./contracts";
import { weightedDistance, similarityFromDistance } from "./distance";
import { MarketMemoryV2EventTypes } from "./events";
import { InMemoryMarketMemoryRepository } from "./repository";
import { createMarketStateVector } from "./vector";

export class MarketMemoryV2Service {
  constructor(private readonly repository = new InMemoryMarketMemoryRepository()) {}
  createVector(input: VectorInput): { vector: MarketStateVector | null; events: DomainEvent[] } {
    try {
      const vector = this.repository.save(createMarketStateVector(input));
      return { vector, events: [createDomainEvent({ eventType: MarketMemoryV2EventTypes.MarketStateVectorCreated, sourceModule: "market-memory", correlationId: input.correlationId, causationId: input.causationId, payload: { stateId: vector.stateId } })] };
    } catch (error) {
      return { vector: null, events: [createDomainEvent({ eventType: MarketMemoryV2EventTypes.MarketStateVectorRejected, sourceModule: "market-memory", correlationId: input.correlationId, causationId: input.causationId, payload: { reason: error instanceof Error ? error.message : "unknown" } })] };
    }
  }
  search(input: SearchInput): { result: HistoricalSimilarityResult; events: DomainEvent[] } {
    const query = this.repository.get(input.queryStateId);
    if (!query) throw new Error("query vector missing");
    const min = input.minNeighbors ?? 3;
    const pool = (input.candidates ?? this.repository.list()).filter((v) => v.stateId !== query.stateId)
      .filter((v) => !input.filters?.symbol || v.symbol === input.filters.symbol)
      .filter((v) => !input.filters?.timeframe || v.timeframe === input.filters.timeframe)
      .filter((v) => !input.filters?.regime || v.regime === input.filters.regime);
    const neighbors = pool.map((v) => ({ stateId: v.stateId, distance: weightedDistance(query, v), similarity: similarityFromDistance(weightedDistance(query, v)), effectiveAt: v.effectiveAt }))
      .filter((n) => Number.isFinite(n.distance))
      .sort((a, b) => a.distance - b.distance || a.effectiveAt.localeCompare(b.effectiveAt) || a.stateId.localeCompare(b.stateId))
      .slice(0, Math.max(min, 1));
    const returns = neighbors.map((n) => (n.similarity - 0.5) * 2);
    const mean = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const result: HistoricalSimilarityResult = {
      queryStateId: query.stateId, vectorVersion: query.vectorVersion, neighbors,
      similarityScore: Number((neighbors.reduce((s, n) => s + n.similarity, 0) / Math.max(1, neighbors.length)).toFixed(8)),
      confidence: Number(Math.min(1, neighbors.length / min).toFixed(4)),
      outcomeDistribution: { sampleSize: neighbors.length, meanReturn: Number(mean.toFixed(8)), medianReturn: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, positiveRate: returns.filter((r) => r > 0).length / Math.max(1, returns.length), adverseExcursion: { min: 0, max: 0, mean: 0 }, favorableExcursion: { min: 0, max: 0, mean: 0 } },
      warnings: neighbors.length < min ? ["insufficient_neighbors"] : [],
      filters: input.filters ?? {}, createdAt: new Date().toISOString(), correlationId: input.correlationId, causationId: input.causationId,
    };
    const eventType = neighbors.length < min ? MarketMemoryV2EventTypes.SimilaritySearchInsufficientNeighbors : MarketMemoryV2EventTypes.SimilaritySearchCompleted;
    return { result, events: [createDomainEvent({ eventType, sourceModule: "market-memory", correlationId: input.correlationId, causationId: input.causationId, payload: { queryStateId: query.stateId, neighbors: neighbors.length } })] };
  }
  get(id: string) { return this.repository.get(id); }
  list() { return this.repository.list(); }
}
export const marketMemoryV2Service = new MarketMemoryV2Service();
