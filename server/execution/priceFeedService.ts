import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import type { DemoBrokerAdapter, PricingSnapshot } from "./brokerSandbox";
import { normalizeSymbol } from "./domain";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { marketDataMetrics, type MarketDataMetrics } from "./marketDataMetrics";

export type PriceTick = {
  id: string;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
  provider: string;
  freshness: "fresh" | "aging" | "stale";
  confidence: number;
};

export interface PollingPriceProvider {
  readonly id: string;
  getPrice(symbol: string): Promise<Omit<PriceTick, "id" | "freshness" | "confidence" | "spread">>;
}

export interface StreamingPriceProvider {
  readonly id: string;
  subscribe(symbols: string[], onTick: (tick: Omit<PriceTick, "id" | "freshness" | "confidence" | "spread">) => void): Promise<() => void>;
}

export type PriceFreshnessPolicy = {
  agingAfterMs: number;
  staleAfterMs: number;
};

export class PriceFeedService {
  private latest = new Map<string, PriceTick>();
  private listeners = new Set<(tick: PriceTick) => void>();

  constructor(
    private readonly policy: PriceFreshnessPolicy = { agingAfterMs: 15_000, staleAfterMs: 30_000 },
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: MarketDataMetrics = marketDataMetrics,
  ) {}

  async poll(provider: PollingPriceProvider, symbol: string, now = new Date()) {
    return this.ingest(await provider.getPrice(symbol), now);
  }

  async connect(provider: StreamingPriceProvider, symbols: string[]) {
    return provider.subscribe(symbols, (tick) => this.ingest(tick));
  }

  ingest(raw: Omit<PriceTick, "id" | "freshness" | "confidence" | "spread">, now = new Date()) {
    const instrument = normalizeSymbol(raw.symbol);
    if (!instrument) throw new Error(`Unsupported price-feed symbol: ${raw.symbol}`);
    if (!(raw.bid > 0 && raw.ask > 0 && raw.ask >= raw.bid)) throw new Error("Invalid bid/ask price");
    const ageMs = Math.max(0, now.getTime() - Date.parse(raw.timestamp));
    const freshness = ageMs > this.policy.staleAfterMs ? "stale" : ageMs > this.policy.agingAfterMs ? "aging" : "fresh";
    const confidence = freshness === "fresh" ? 100 : freshness === "aging" ? 70 : 20;
    const tick: PriceTick = {
      id: randomUUID(),
      ...raw,
      symbol: instrument.symbol,
      mid: round((raw.bid + raw.ask) / 2),
      spread: round(raw.ask - raw.bid),
      freshness,
      confidence,
    };
    this.latest.set(instrument.symbol, tick);
    this.metrics.recordTick(freshness === "stale");
    this.events.append({
      type: "price.tick_received",
      userId: "system",
      sourceService: "price-feed",
      correlationId: tick.id,
      payload: { symbol: tick.symbol, provider: tick.provider, freshness, confidence },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "price.tick",
      outcome: freshness === "stale" ? "rejected" : "accepted",
      correlationId: tick.id,
      detail: { symbol: tick.symbol, provider: tick.provider, freshness, ageMs },
    });
    this.listeners.forEach((listener) => listener({ ...tick }));
    return tick;
  }

  getLatest(symbol: string, now = new Date()) {
    const instrument = normalizeSymbol(symbol);
    if (!instrument) return undefined;
    const tick = this.latest.get(instrument.symbol);
    if (!tick) return undefined;
    return this.reclassify(tick, now);
  }

  listLatest(now = new Date()) {
    return Array.from(this.latest.values()).map((tick) => this.reclassify(tick, now));
  }

  onTick(listener: (tick: PriceTick) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reclassify(tick: PriceTick, now: Date): PriceTick {
    const ageMs = Math.max(0, now.getTime() - Date.parse(tick.timestamp));
    const freshness = ageMs > this.policy.staleAfterMs ? "stale" : ageMs > this.policy.agingAfterMs ? "aging" : "fresh";
    return { ...tick, freshness, confidence: freshness === "fresh" ? 100 : freshness === "aging" ? 70 : 20 };
  }
}

export class DemoPriceFeedProvider implements PollingPriceProvider {
  readonly id = "demo_price_feed";
  private sequence = 0;

  constructor(private readonly prices: Record<string, number> = { "EUR/USD": 1.1, "XAU/USD": 2350, WTI: 78 }) {}

  async getPrice(symbol: string) {
    const instrument = normalizeSymbol(symbol);
    if (!instrument || this.prices[instrument.symbol] === undefined) throw new Error("Demo price is unavailable");
    const base = this.prices[instrument.symbol] + this.sequence++ * instrument.tickSize;
    return {
      symbol: instrument.symbol,
      bid: base,
      ask: base + instrument.tickSize * 2,
      mid: base + instrument.tickSize,
      timestamp: new Date().toISOString(),
      provider: this.id,
    };
  }
}

export class BrokerPollingPriceProvider implements PollingPriceProvider {
  readonly id: string;
  constructor(private readonly adapter: DemoBrokerAdapter) {
    this.id = `${adapter.id}_pricing`;
  }

  async getPrice(symbol: string) {
    return fromBrokerSnapshot(await this.adapter.getPricingSnapshot(symbol));
  }
}

export class OandaPracticePriceFeedProvider extends BrokerPollingPriceProvider {}
export class MetaTraderBridgePriceFeedProvider extends BrokerPollingPriceProvider {}

function fromBrokerSnapshot(snapshot: PricingSnapshot) {
  return {
    symbol: snapshot.internalSymbol,
    bid: snapshot.bid,
    ask: snapshot.ask,
    mid: snapshot.mid,
    timestamp: snapshot.asOf,
    provider: snapshot.provider,
  };
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const priceFeedService = new PriceFeedService();
