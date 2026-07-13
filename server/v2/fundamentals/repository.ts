import type { CorporateEvent, EconomicEvent, FundamentalSnapshot, FundamentalsRepository } from "./contracts";

export class InMemoryFundamentalsRepository implements FundamentalsRepository {
  private economic = new Map<string, EconomicEvent>();
  private corporate = new Map<string, CorporateEvent>();
  private snapshots = new Map<string, FundamentalSnapshot>();

  async saveEconomic(event: EconomicEvent) {
    const existing = this.economic.get(event.eventId);
    const conflicted = Boolean(existing && JSON.stringify(existing) !== JSON.stringify(event));
    if (!existing) this.economic.set(event.eventId, { ...event });
    return { inserted: !existing, conflicted };
  }

  async saveCorporate(event: CorporateEvent) {
    const existing = this.corporate.get(event.eventId);
    const conflicted = Boolean(existing && JSON.stringify(existing) !== JSON.stringify(event));
    if (!existing) this.corporate.set(event.eventId, { ...event, values: { ...event.values } });
    return { inserted: !existing, conflicted };
  }

  async saveSnapshot(snapshot: FundamentalSnapshot) {
    this.snapshots.set(snapshot.snapshotId, { ...snapshot, macroState: { ...snapshot.macroState } });
  }

  async listEconomic(symbolOrCurrency: string, effectiveAt: string) {
    return Array.from(this.economic.values()).filter((event) => event.currency === symbolOrCurrency || symbolOrCurrency.includes(event.currency)).filter((event) => event.publishedAt <= effectiveAt && event.expiresAt > effectiveAt);
  }

  async listCorporate(symbol: string, effectiveAt: string) {
    return Array.from(this.corporate.values()).filter((event) => event.symbol === symbol && event.publishedAt <= effectiveAt && event.expiresAt > effectiveAt);
  }
}
