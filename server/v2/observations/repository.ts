import type { MarketObservation } from "./contracts";
import { evidenceFingerprint } from "./evidence";

export type EligibleObservationQuery = {
  symbol: string;
  timeframe: string;
  detectorId: string;
  observationType: string;
  strategyFamily?: string;
  lookbackHours: number;
  minimumQualityScore: number;
  now: Date;
  limit: number;
};

export type ObservationSemanticGroup = {
  symbol: string;
  timeframe: string;
  detectorId: string;
  observationType: string;
  strategyFamily?: string;
};

export type EligibleSemanticGroupsQuery = {
  lookbackHours: number;
  minimumQualityScore: number;
  now: Date;
  limit: number;
};

export class InMemoryObservationRepository {
  private observations = new Map<string, MarketObservation>();
  private fingerprints = new Map<string, string>();

  save(observation: MarketObservation) {
    const fingerprint = `${observation.symbol}:${observation.timeframe}:${observation.observationType}:${observation.detectorVersion}:${evidenceFingerprint(observation.evidence)}:${observation.effectiveFrom}`;
    const existing = this.fingerprints.get(fingerprint);
    if (existing) return { inserted: false, observation: this.observations.get(existing)! };
    this.observations.set(observation.observationId, clone(observation));
    this.fingerprints.set(fingerprint, observation.observationId);
    return { inserted: true, observation };
  }

  list() { return Array.from(this.observations.values()).map(clone); }
  get(id: string) { const found = this.observations.get(id); return found ? clone(found) : null; }

  async eligibleForHypothesis(input: EligibleObservationQuery): Promise<MarketObservation[]> {
    return this.list()
      .filter(observation => eligibleObservation(observation, input))
      .sort(compareObservations)
      .slice(0, input.limit);
  }

  async eligibleSemanticGroups(input: EligibleSemanticGroupsQuery): Promise<ObservationSemanticGroup[]> {
    const latestByKey = new Map<string, { group: ObservationSemanticGroup; newestObservedAt: string }>();
    for (const observation of this.list().filter(item => eligibleObservation(item, input))) {
      const group = semanticGroupFromObservation(observation);
      const key = semanticGroupKey(group);
      const existing = latestByKey.get(key);
      if (!existing || Date.parse(observation.observedAt) > Date.parse(existing.newestObservedAt)) {
        latestByKey.set(key, { group, newestObservedAt: observation.observedAt });
      }
    }
    return Array.from(latestByKey.entries())
      .sort((left, right) => {
        const observedDiff = Date.parse(right[1].newestObservedAt) - Date.parse(left[1].newestObservedAt);
        return observedDiff || left[0].localeCompare(right[0]);
      })
      .map(([, value]) => value.group)
      .slice(0, input.limit);
  }
}
function clone(item: MarketObservation): MarketObservation { return { ...item, evidence: item.evidence.map((e) => ({ ...e })), contradictoryEvidence: item.contradictoryEvidence.map((e) => ({ ...e })), upstreamEventIds: [...item.upstreamEventIds] }; }

export function semanticGroupFromObservation(observation: MarketObservation): ObservationSemanticGroup {
  return {
    symbol: observation.symbol,
    timeframe: observation.timeframe,
    detectorId: observation.detectorId,
    observationType: observation.observationType,
    strategyFamily: observation.strategyFamily,
  };
}

export function semanticGroupKey(group: ObservationSemanticGroup): string {
  return JSON.stringify({
    symbol: group.symbol,
    timeframe: group.timeframe,
    detectorId: group.detectorId,
    observationType: group.observationType,
    strategyFamily: group.strategyFamily ?? null,
  });
}

function eligibleObservation(observation: MarketObservation, input: EligibleObservationQuery | EligibleSemanticGroupsQuery) {
  if ("symbol" in input && observation.symbol !== input.symbol) return false;
  if ("timeframe" in input && observation.timeframe !== input.timeframe) return false;
  if ("detectorId" in input && observation.detectorId !== input.detectorId) return false;
  if ("observationType" in input && observation.observationType !== input.observationType) return false;
  if ("symbol" in input && observation.strategyFamily !== input.strategyFamily) return false;
  const since = input.now.getTime() - input.lookbackHours * 60 * 60_000;
  return observation.lifecycle === "active"
    && Date.parse(observation.expiresAt) > input.now.getTime()
    && observation.qualityScore >= input.minimumQualityScore
    && Boolean(observation.candleEnd)
    && Boolean(observation.sourceDataHash)
    && Date.parse(observation.observedAt) >= since
    && !observation.supersedesId;
}

function compareObservations(left: MarketObservation, right: MarketObservation) {
  return Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || left.observationId.localeCompare(right.observationId);
}
