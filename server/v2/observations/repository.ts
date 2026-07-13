import type { MarketObservation } from "./contracts";
import { evidenceFingerprint } from "./evidence";

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
}
function clone(item: MarketObservation): MarketObservation { return { ...item, evidence: item.evidence.map((e) => ({ ...e })), contradictoryEvidence: item.contradictoryEvidence.map((e) => ({ ...e })), upstreamEventIds: [...item.upstreamEventIds] }; }
