import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ObservationDetector, ObservationInput } from "./contracts";
import { ObservationsV2EventTypes } from "./events";
import { InMemoryObservationRepository } from "./repository";
import { breakoutDetector } from "./detectors/breakoutDetector";
import { compressionDetector } from "./detectors/compressionDetector";
import { liquiditySweepDetector } from "./detectors/liquiditySweepDetector";

export class ObservationsV2Service {
  constructor(private readonly repository = new InMemoryObservationRepository(), private readonly detectors: ObservationDetector[] = [compressionDetector, breakoutDetector, liquiditySweepDetector]) {}

  create(input: ObservationInput) {
    if (!input.contextEventId || !input.upstreamEventIds.length) throw new Error("Observation requires complete lineage and context");
    if (input.evidence.some((item) => Date.parse(item.observedAt) > Date.parse(input.observedAt))) throw new Error("Observation rejected future evidence");
    const observations = this.detectors.flatMap((detector) => detector.detect(input));
    const events: DomainEvent[] = [];
    const inserted = [];
    for (const observation of observations) {
      const saved = this.repository.save(observation);
      if (!saved.inserted) continue;
      inserted.push(saved.observation);
      events.push(createDomainEvent({ eventType: ObservationsV2EventTypes.MarketObservationCreated, sourceModule: "observations", correlationId: input.correlationId, causationId: input.causationId, payload: { observationId: observation.observationId, observationType: observation.observationType }, metadata: { upstreamEventIds: observation.upstreamEventIds } }));
    }
    if (!inserted.length && observations.length === 0) events.push(createDomainEvent({ eventType: ObservationsV2EventTypes.ObservationEvidenceInsufficient, sourceModule: "observations", correlationId: input.correlationId, causationId: input.causationId, payload: { symbol: input.symbol, timeframe: input.timeframe } }));
    return { observations: inserted, events };
  }
  list() { return this.repository.list(); }
  get(id: string) { return this.repository.get(id); }
}
export const observationsV2Service = new ObservationsV2Service();
