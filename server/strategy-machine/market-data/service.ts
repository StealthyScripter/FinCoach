import { createEvent, toEventReference, type EventEnvelope, type EventReference } from "../core";
import { MarketDataEventTypes } from "./events";
import { candleSchema, supportedInstruments, type Candle, type EconomicContext, type MarketSnapshot, type SessionContext, type SpreadState, type VolatilityState } from "./contracts";
import { MarketDataRepository } from "./repository";

export class MarketDataService {
  constructor(private readonly repository = new MarketDataRepository()) {}

  supportedInstruments() {
    return supportedInstruments.map((instrument) => ({ ...instrument }));
  }

  assertSupported(instrument: string) {
    const normalized = normalizeInstrument(instrument);
    const found = supportedInstruments.find((item) => item.symbol === normalized && item.enabled);
    if (!found) throw new Error(`Unsupported instrument: ${instrument}`);
    return found;
  }

  createSnapshot(input: Omit<MarketSnapshot, "instrument" | "mid" | "spread" | "observedAt"> & { instrument: string; observedAt?: Date }, refs: EventReference[] = []) {
    const instrument = this.assertSupported(input.instrument).symbol;
    if (input.ask < input.bid) throw new Error("Snapshot ask must be greater than or equal to bid");
    const snapshot: MarketSnapshot = {
      instrument,
      bid: input.bid,
      ask: input.ask,
      mid: round((input.bid + input.ask) / 2),
      spread: round(input.ask - input.bid),
      provider: input.provider,
      observedAt: (input.observedAt ?? new Date()).toISOString(),
    };
    this.repository.saveSnapshot(snapshot);
    return createEvent({ type: MarketDataEventTypes.MarketSnapshotCreated, module: "market-data", payload: snapshot, sourceEventRefs: refs });
  }

  createCandleSeries(candles: Candle[], refs: EventReference[] = []) {
    if (candles.length === 0) throw new Error("Candle series is empty");
    const normalized = candles.map((candle) => candleSchema.parse({ ...candle, instrument: this.assertSupported(candle.instrument).symbol }));
    normalized.forEach((candle) => {
      if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) throw new Error("Invalid candle OHLC range");
    });
    this.repository.saveCandles(normalized);
    return createEvent({
      type: MarketDataEventTypes.CandleSeriesCreated,
      module: "market-data",
      payload: { instrument: normalized[0].instrument, timeframe: normalized[0].timeframe, candles: normalized },
      sourceEventRefs: refs,
    });
  }

  detectSession(instrument: string, observedAt: Date) {
    const normalized = this.assertSupported(instrument).symbol;
    const hour = observedAt.getUTCHours();
    const session: SessionContext["session"] = hour >= 7 && hour < 12 ? "london" : hour >= 12 && hour < 16 ? "overlap" : hour >= 16 && hour < 21 ? "new_york" : hour >= 0 && hour < 7 ? "asia" : "off_hours";
    return createEvent({ type: MarketDataEventTypes.SessionContextCreated, module: "market-data", payload: { instrument: normalized, session, observedAt: observedAt.toISOString() } });
  }

  detectVolatility(candles: Candle[]) {
    const event = this.createCandleSeries(candles);
    const series = (event.payload.candles as Candle[]);
    const atr = average(series.map((candle) => candle.high - candle.low));
    const baseline = average(series.map((candle) => Math.abs(candle.close))) * 0.001;
    const state: VolatilityState["state"] = atr < baseline * 0.7 ? "compressed" : atr > baseline * 1.5 ? "expanded" : "normal";
    return createEvent({
      type: MarketDataEventTypes.VolatilityStateDetected,
      module: "market-data",
      payload: { instrument: series[0].instrument, timeframe: series[0].timeframe, atr: round(atr), state },
      sourceEventRefs: [toEventReference(event)],
    });
  }

  detectSpread(snapshotEvent: EventEnvelope<MarketSnapshot>) {
    const snapshot = snapshotEvent.payload;
    const basis = snapshot.instrument.includes("JPY") ? 0.03 : snapshot.instrument.startsWith("XAU") ? 0.5 : snapshot.instrument.startsWith("XAG") ? 0.05 : 0.0003;
    const state: SpreadState["state"] = snapshot.spread <= basis ? "tight" : snapshot.spread > basis * 3 ? "wide" : "normal";
    return createEvent({
      type: MarketDataEventTypes.SpreadStateDetected,
      module: "market-data",
      payload: { instrument: snapshot.instrument, spread: snapshot.spread, state },
      sourceEventRefs: [toEventReference(snapshotEvent)],
    });
  }

  attachEconomicContext(instrument: string, now: Date, refs: EventReference[] = []) {
    const normalized = this.assertSupported(instrument).symbol;
    const isMajorWindow = now.getUTCHours() === 12 || now.getUTCHours() === 13;
    const context: EconomicContext = { instrument: normalized, impact: isMajorWindow ? "high" : "none", blackout: isMajorWindow, source: "fixture", sourceEventRefs: refs };
    return createEvent({ type: MarketDataEventTypes.EconomicContextAttached, module: "market-data", payload: context, sourceEventRefs: refs });
  }
}

export function normalizeInstrument(instrument: string) {
  return instrument.trim().toUpperCase().replace("/", "_");
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const marketDataService = new MarketDataService();
