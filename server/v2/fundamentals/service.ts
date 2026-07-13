import { randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import { corporateEventSchema, economicEventSchema, extractedClaimSchema, type CorporateEvent, type EconomicEvent, type ExtractedClaim, type FundamentalSnapshot } from "./contracts";
import { FundamentalsV2EventTypes } from "./events";
import { InMemoryFundamentalsRepository } from "./repository";

export class FundamentalsV2Service {
  constructor(private readonly repository = new InMemoryFundamentalsRepository()) {}

  async ingestEconomic(input: Omit<EconomicEvent, "surprise"> & { surprise?: number | null }) {
    const event = economicEventSchema.parse({ ...input, surprise: input.actual === null || input.forecast === null ? null : round(input.actual - input.forecast) });
    if (event.publishedAt < event.sourceTimestamp) throw new Error("publication-time alignment invalid");
    const saved = await this.repository.saveEconomic(event);
    const events: DomainEvent[] = [createDomainEvent({ eventType: FundamentalsV2EventTypes.EconomicEventIngested, sourceModule: "fundamentals", payload: { eventId: event.eventId, currency: event.currency, eventType: event.eventType } })];
    if (event.surprise !== null) events.push(createDomainEvent({ eventType: FundamentalsV2EventTypes.EconomicSurpriseComputed, sourceModule: "fundamentals", causationId: events[0].eventId, correlationId: events[0].correlationId, payload: { eventId: event.eventId, surprise: event.surprise } }));
    if (saved.conflicted) events.push(createDomainEvent({ eventType: FundamentalsV2EventTypes.FundamentalEvidenceConflicted, sourceModule: "fundamentals", causationId: events[0].eventId, correlationId: events[0].correlationId, payload: { eventId: event.eventId } }));
    return { event, events };
  }

  async ingestCorporate(input: CorporateEvent) {
    const event = corporateEventSchema.parse(input);
    const saved = await this.repository.saveCorporate(event);
    const events: DomainEvent[] = [createDomainEvent({ eventType: FundamentalsV2EventTypes.CorporateEventIngested, sourceModule: "fundamentals", payload: { eventId: event.eventId, symbol: event.symbol, eventType: event.eventType } })];
    if (saved.conflicted) events.push(createDomainEvent({ eventType: FundamentalsV2EventTypes.FundamentalEvidenceConflicted, sourceModule: "fundamentals", causationId: events[0].eventId, correlationId: events[0].correlationId, payload: { eventId: event.eventId } }));
    return { event, events };
  }

  extractClaim(input: ExtractedClaim) {
    const claim = extractedClaimSchema.parse(input);
    if (claim.verificationStatus !== "verified" || !claim.citation.trim()) {
      return { claim, events: [createDomainEvent({ eventType: FundamentalsV2EventTypes.FundamentalClaimRejected, sourceModule: "fundamentals", payload: { claimId: claim.claimId, reason: "unverified_or_uncited" } })] };
    }
    return { claim, events: [createDomainEvent({ eventType: FundamentalsV2EventTypes.FundamentalClaimExtracted, sourceModule: "fundamentals", payload: { claimId: claim.claimId, claimType: claim.claimType } })] };
  }

  async snapshot(input: { symbol: string; currency?: string; effectiveAt: string; now?: Date }) {
    const effectiveAt = input.effectiveAt;
    const economic = input.currency ? await this.repository.listEconomic(input.currency, effectiveAt) : [];
    const corporate = await this.repository.listCorporate(input.symbol, effectiveAt);
    const snapshot: FundamentalSnapshot = {
      snapshotId: randomUUID(),
      symbol: input.symbol,
      effectiveAt,
      createdAt: (input.now ?? new Date(effectiveAt)).toISOString(),
      economicEventIds: economic.map((event) => event.eventId),
      corporateEventIds: corporate.map((event) => event.eventId),
      macroState: { latestEconomicImportance: economic.at(-1)?.importance ?? "none", corporateEventCount: corporate.length },
      sourceCount: new Set([...economic.map((event) => event.source), ...corporate.map((event) => event.source)]).size,
      qualityScore: economic.length || corporate.length ? 1 : 0.3,
    };
    await this.repository.saveSnapshot(snapshot);
    return { snapshot, events: [createDomainEvent({ eventType: FundamentalsV2EventTypes.FundamentalSnapshotCreated, sourceModule: "fundamentals", payload: { snapshotId: snapshot.snapshotId, symbol: snapshot.symbol, sourceCount: snapshot.sourceCount } })] };
  }
}

function round(value: number) { return Number(value.toFixed(6)); }
export const fundamentalsV2Service = new FundamentalsV2Service();
