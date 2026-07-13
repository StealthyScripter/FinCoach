import { createHash, randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type {
  AssetClass,
  MarketDataImportResult,
  MarketDataProviderAdapter,
  MarketDataQualityReport,
  NormalizedCandle,
  NormalizedQuote,
  NormalizedSymbol,
  V2Timeframe,
} from "./contracts";
import { normalizedCandleSchema, normalizedQuoteSchema, v2Timeframes } from "./contracts";
import { MarketDataV2EventTypes } from "./events";
import { InMemoryMarketDataRepository } from "./repository";

const STOCK_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const FOREX_OR_METAL = /^([A-Z]{3})[_/]?([A-Z]{3})$/;
const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);
const FIAT = new Set(["AUD", "CAD", "CHF", "CNH", "EUR", "GBP", "HKD", "JPY", "MXN", "NOK", "NZD", "SEK", "SGD", "USD", "ZAR"]);

export class MarketDataV2Service {
  constructor(private readonly repository = new InMemoryMarketDataRepository()) {}

  normalizeSymbol(input: string): NormalizedSymbol {
    const raw = input.trim().toUpperCase().replace(/\s+/g, "");
    const pair = raw.match(FOREX_OR_METAL);
    if (pair) {
      const supportedBase = FIAT.has(pair[1]) || METALS.has(pair[1]);
      const supportedQuote = FIAT.has(pair[2]) || METALS.has(pair[2]);
      if (!supportedBase || !supportedQuote) throw new Error(`Unsupported symbol format: ${input}`);
      const symbol = `${pair[1]}_${pair[2]}`;
      const assetClass: AssetClass = METALS.has(pair[1]) || METALS.has(pair[2]) ? "metal" : "forex";
      return {
        symbol,
        assetClass,
        providerSymbols: {
          oanda_practice: symbol,
          polygon: symbol.replace("_", ""),
        },
      };
    }
    if (STOCK_SYMBOL.test(raw)) {
      return {
        symbol: raw,
        assetClass: "stock",
        providerSymbols: {
          polygon: raw,
          alpha_vantage: raw,
        },
      };
    }
    throw new Error(`Unsupported symbol format: ${input}`);
  }

  normalizeQuote(input: {
    symbol: string;
    bid: number;
    ask: number;
    provider: string;
    providerSymbol?: string;
    adapterVersion?: string;
    observedAt: string | Date;
    sourceReceivedAt?: string | Date;
  }): NormalizedQuote {
    const symbol = this.normalizeSymbol(input.symbol);
    if (!Number.isFinite(input.bid) || !Number.isFinite(input.ask) || input.bid <= 0 || input.ask <= 0) {
      throw new Error("Quote bid and ask must be positive finite numbers");
    }
    if (input.ask < input.bid) throw new Error("Quote ask must be greater than or equal to bid");
    return normalizedQuoteSchema.parse({
      symbol: symbol.symbol,
      bid: round(input.bid),
      ask: round(input.ask),
      mid: round((input.bid + input.ask) / 2),
      spread: round(input.ask - input.bid),
      provider: input.provider,
      observedAt: iso(input.observedAt),
      sourceReceivedAt: iso(input.sourceReceivedAt ?? new Date()),
      provenance: {
        provider: input.provider,
        providerSymbol: input.providerSymbol ?? symbol.providerSymbols[input.provider] ?? symbol.symbol,
        adapterVersion: input.adapterVersion ?? "contract.v1",
      },
    });
  }

  normalizeCandle(input: {
    symbol: string;
    timeframe: V2Timeframe;
    timestamp: string | Date;
    open: number;
    high: number;
    low: number;
    close: number;
    bid?: { open: number; high: number; low: number; close: number };
    ask?: { open: number; high: number; low: number; close: number };
    spread?: number | null;
    volume?: number | null;
    tickVolume?: number | null;
    complete?: boolean;
    provider: string;
    providerSymbol?: string;
    adapterVersion?: string;
    corporateAction?: NormalizedCandle["corporateAction"];
  }): NormalizedCandle {
    const symbol = this.normalizeSymbol(input.symbol);
    if (!v2Timeframes.includes(input.timeframe)) throw new Error(`Unsupported timeframe: ${input.timeframe}`);
    validateOhlc(input);
    const candle = normalizedCandleSchema.parse({
      symbol: symbol.symbol,
      timeframe: input.timeframe,
      timestamp: iso(input.timestamp),
      open: round(input.open),
      high: round(input.high),
      low: round(input.low),
      close: round(input.close),
      bid: input.bid,
      ask: input.ask,
      spread: input.spread ?? spreadFromBidAsk(input.bid, input.ask),
      volume: input.volume ?? null,
      tickVolume: input.tickVolume ?? null,
      complete: input.complete ?? true,
      source: {
        provider: input.provider,
        providerSymbol: input.providerSymbol ?? symbol.providerSymbols[input.provider] ?? symbol.symbol,
        adapterVersion: input.adapterVersion ?? "contract.v1",
      },
      corporateAction: symbol.assetClass === "stock"
        ? input.corporateAction ?? { splitAdjusted: false, dividendAdjusted: false, adjustmentFactor: null }
        : null,
    });
    return candle;
  }

  assessQuality(candles: NormalizedCandle[], now = new Date()): MarketDataQualityReport {
    if (candles.length === 0) throw new Error("Cannot assess empty candle set");
    const sorted = [...candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const duplicates = candles.length - new Set(candles.map(candleKey)).size;
    const orderingValid = candles.every((candle, index) => index === 0 || candle.timestamp > candles[index - 1].timestamp);
    const gaps = detectGaps(sorted);
    const stale = now.getTime() - Date.parse(sorted[sorted.length - 1].timestamp) > staleThresholdMs(sorted[0].timeframe);
    const warnings = [
      duplicates ? `${duplicates} duplicate candle(s) detected.` : null,
      !orderingValid ? "Candles are not strictly ordered." : null,
      gaps.length ? `${gaps.length} timestamp gap(s) detected.` : null,
      stale ? "Latest candle is stale." : null,
      sorted.some((candle) => !candle.complete) ? "Incomplete candle included." : null,
    ].filter((warning): warning is string => Boolean(warning));
    const penalty = duplicates * 8 + gaps.length * 10 + (orderingValid ? 0 : 20) + (stale ? 25 : 0);
    return {
      symbol: sorted[0].symbol,
      timeframe: sorted[0].timeframe,
      candlesReceived: candles.length,
      candlesAccepted: candles.length - duplicates,
      duplicates,
      rejected: 0,
      gaps,
      orderingValid,
      fresh: !stale,
      qualityScore: Math.max(0, Math.min(1, roundScore(1 - penalty / 100))),
      warnings,
    };
  }

  async importCandles(input: {
    candles: NormalizedCandle[];
    idempotencyKey?: string;
    correlationId?: string;
    causationId?: string | null;
    now?: Date;
  }): Promise<{ result: MarketDataImportResult; domainEvents: DomainEvent[] }> {
    if (input.candles.length === 0) throw new Error("Market data import requires at least one candle");
    const idempotencyKey = input.idempotencyKey ?? hashCandles(input.candles);
    if (await this.repository.hasImport(idempotencyKey)) {
      const quality = this.assessQuality(input.candles, input.now);
      return {
        result: {
          importId: idempotencyKey,
          idempotencyKey,
          status: "duplicate",
          quality,
          lineage: [],
          events: [],
        },
        domainEvents: [],
      };
    }
    const quality = this.assessQuality(input.candles, input.now);
    const importId = randomUUID();
    const persisted = await this.repository.importCandles(importId, input.candles);
    const imported = createDomainEvent({
      eventType: MarketDataV2EventTypes.MarketDataImported,
      sourceModule: "market-data",
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      payload: {
        importId,
        symbol: quality.symbol,
        timeframe: quality.timeframe,
        inserted: persisted.inserted,
        duplicates: persisted.duplicates,
        qualityScore: quality.qualityScore,
      },
      metadata: { idempotencyKey },
      occurredAt: input.now,
    });
    const events: DomainEvent[] = [imported];
    if (quality.gaps.length) {
      events.push(createDomainEvent({
        eventType: MarketDataV2EventTypes.MarketDataGapDetected,
        sourceModule: "market-data",
        correlationId: imported.correlationId,
        causationId: imported.eventId,
        payload: { importId, symbol: quality.symbol, timeframe: quality.timeframe, gaps: quality.gaps },
        metadata: { lineage: [{ eventId: imported.eventId, eventType: imported.eventType, schemaVersion: imported.schemaVersion, sourceModule: imported.sourceModule, occurredAt: imported.occurredAt }] },
        occurredAt: input.now,
      }));
    }
    if (!quality.fresh) {
      events.push(createDomainEvent({
        eventType: MarketDataV2EventTypes.MarketDataBecameStale,
        sourceModule: "market-data",
        correlationId: imported.correlationId,
        causationId: imported.eventId,
        payload: { importId, symbol: quality.symbol, timeframe: quality.timeframe },
        metadata: { lineage: [{ eventId: imported.eventId, eventType: imported.eventType, schemaVersion: imported.schemaVersion, sourceModule: imported.sourceModule, occurredAt: imported.occurredAt }] },
        occurredAt: input.now,
      }));
    }
    const result: MarketDataImportResult = {
      importId,
      idempotencyKey,
      status: persisted.inserted === 0 ? "duplicate" : quality.qualityScore < 0.7 ? "partial" : "imported",
      quality,
      lineage: [],
      events: events.map((event) => event.eventId),
    };
    await this.repository.recordImport(idempotencyKey, result);
    return { result, domainEvents: events };
  }

  async importFromProvider(adapter: MarketDataProviderAdapter, input: {
    symbol: string;
    timeframe: V2Timeframe;
    limit: number;
    cursor?: string | null;
  }) {
    const symbol = this.normalizeSymbol(input.symbol);
    if (!adapter.assetClasses.includes(symbol.assetClass)) throw new Error(`Provider ${adapter.id} does not support ${symbol.assetClass}`);
    const checkpointKey = `${adapter.id}:${symbol.symbol}:${input.timeframe}`;
    const cursor = input.cursor ?? await this.repository.readCheckpoint(checkpointKey);
    const page = await adapter.fetchCandles({ symbol, timeframe: input.timeframe, cursor, limit: input.limit });
    const candles = page.candles.map((raw) => this.normalizeProviderCandle(raw, adapter, symbol, input.timeframe));
    const imported = await this.importCandles({ candles, idempotencyKey: `${checkpointKey}:${cursor ?? "start"}:${input.limit}` });
    await this.repository.saveCheckpoint(checkpointKey, page.nextCursor);
    return { ...imported, nextCursor: page.nextCursor, rateLimitedUntil: page.rateLimitedUntil };
  }

  private normalizeProviderCandle(raw: unknown, adapter: MarketDataProviderAdapter, symbol: NormalizedSymbol, timeframe: V2Timeframe) {
    const value = raw as Record<string, unknown>;
    return this.normalizeCandle({
      symbol: symbol.symbol,
      timeframe,
      timestamp: String(value.timestamp ?? value.time),
      open: Number(value.open),
      high: Number(value.high),
      low: Number(value.low),
      close: Number(value.close),
      volume: value.volume == null ? null : Number(value.volume),
      tickVolume: value.tickVolume == null ? null : Number(value.tickVolume),
      spread: value.spread == null ? null : Number(value.spread),
      complete: value.complete !== false,
      provider: adapter.id,
      providerSymbol: symbol.providerSymbols[adapter.id] ?? symbol.symbol,
      adapterVersion: adapter.adapterVersion,
    });
  }
}

function validateOhlc(input: { open: number; high: number; low: number; close: number }) {
  for (const field of ["open", "high", "low", "close"] as const) {
    const value = input[field];
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Candle ${field} must be a positive finite number`);
  }
  if (input.high < Math.max(input.open, input.close) || input.low > Math.min(input.open, input.close)) {
    throw new Error("Candle OHLC range is invalid");
  }
}

function spreadFromBidAsk(bid?: NormalizedCandle["bid"], ask?: NormalizedCandle["ask"]) {
  if (!bid || !ask) return null;
  return round(Math.max(0, ask.close - bid.close));
}

function detectGaps(candles: NormalizedCandle[]) {
  const expected = timeframeMs(candles[0].timeframe);
  return candles.slice(1).flatMap((candle, index) => {
    const previous = candles[index];
    const delta = Date.parse(candle.timestamp) - Date.parse(previous.timestamp);
    if (delta <= expected * 1.5) return [];
    return [{ from: previous.timestamp, to: candle.timestamp, missingCandles: Math.max(1, Math.round(delta / expected) - 1) }];
  });
}

function staleThresholdMs(timeframe: V2Timeframe) {
  return timeframeMs(timeframe) * 3;
}

function timeframeMs(timeframe: V2Timeframe) {
  const minutes =
    timeframe === "1m" ? 1
      : timeframe === "5m" ? 5
        : timeframe === "15m" ? 15
          : timeframe === "30m" ? 30
            : timeframe === "1h" ? 60
              : timeframe === "4h" ? 240
                : timeframe === "1d" ? 1440
                  : timeframe === "1w" ? 10080
                    : timeframe === "1mo" ? 43200
                      : exhaustive(timeframe);
  return minutes * 60_000;
}

function hashCandles(candles: NormalizedCandle[]) {
  return createHash("sha256").update(JSON.stringify(candles.map(candleKey).sort())).digest("hex");
}

function candleKey(candle: NormalizedCandle) {
  return `${candle.symbol}:${candle.timeframe}:${candle.timestamp}`;
}

function iso(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp");
  return date.toISOString();
}

function round(value: number) {
  return Number(value.toFixed(8));
}

function roundScore(value: number) {
  return Number(value.toFixed(4));
}

function exhaustive(value: never): never {
  throw new Error(`Unsupported timeframe: ${value}`);
}

export const marketDataV2Service = new MarketDataV2Service();
