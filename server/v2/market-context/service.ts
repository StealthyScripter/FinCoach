import { randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { NormalizedCandle, NormalizedQuote } from "../market-data";
import { marketContextInputSchema, type MarketContext, type MarketContextInput, type MarketSession } from "./contracts";
import { MarketContextV2EventTypes } from "./events";

export class MarketContextV2Service {
  create(input: MarketContextInput): { context: MarketContext; events: DomainEvent[] } {
    const parsed = marketContextInputSchema.parse(input);
    const observedAt = new Date(parsed.observedAt);
    const eastern = easternMoment(observedAt);
    const holiday = isHoliday(eastern);
    const activeSession = sessionFor(parsed.assetClass, observedAt, holiday);
    const marketOpen = activeSession !== "closed";
    const eventProximity = proximity(parsed.events, parsed.symbol, observedAt, ["macro", "central_bank", "liquidity"]);
    const economicReleaseProximity = proximity(parsed.events, parsed.symbol, observedAt, ["macro", "central_bank"]);
    const earningsProximity = proximity(parsed.events, parsed.symbol, observedAt, ["earnings"]);
    const context: MarketContext = {
      contextId: randomUUID(),
      symbol: parsed.symbol,
      assetClass: parsed.assetClass,
      observedAt: observedAt.toISOString(),
      activeSession,
      marketOpen,
      sessionOverlap: activeSession === "london_new_york_overlap",
      spreadState: spreadState(parsed.quote),
      liquidityState: liquidityState(activeSession, parsed.quote),
      volatilityPercentile: volatilityPercentile(parsed.candles),
      trendRangeRegime: trendRangeRegime(parsed.candles),
      eventProximity,
      economicReleaseProximity,
      earningsProximity,
      higherTimeframeDirection: parsed.higherTimeframeDirection,
      crossAssetContext: { ...parsed.crossAssetContext },
      holiday,
      rollover: parsed.assetClass !== "stock" && isRollover(eastern),
      dataQualityState: dataQuality(parsed.quote, parsed.candles, observedAt, parsed.calendarFreshAsOf),
      warnings: [],
    };
    context.warnings = warnings(context, parsed.calendarFreshAsOf, observedAt);
    const created = createDomainEvent({
      eventType: MarketContextV2EventTypes.MarketContextCreated,
      sourceModule: "market-context",
      payload: context,
      occurredAt: observedAt,
    });
    const events = [created, ...changeEvents(context, created, observedAt)];
    return { context, events };
  }
}

function sessionFor(assetClass: MarketContextInput["assetClass"], now: Date, holiday: boolean): MarketSession {
  const utcDay = now.getUTCDay();
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (holiday) return "closed";
  if (assetClass === "stock") {
    const eastern = easternMoment(now);
    const minutes = eastern.hour * 60 + eastern.minute;
    if (eastern.weekday >= 1 && eastern.weekday <= 5 && minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "asia";
    if (eastern.weekday >= 1 && eastern.weekday <= 5 && minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "new_york";
    if (eastern.weekday >= 1 && eastern.weekday <= 5 && minutes >= 16 * 60 && minutes < 20 * 60) return "new_york";
    return "closed";
  }
  if (utcDay === 6) return "closed";
  if (utcDay === 0 && hour < 22) return "closed";
  if (utcDay === 5 && hour >= 22) return "closed";
  if (hour >= 12 && hour < 16) return "london_new_york_overlap";
  if (hour >= 7 && hour < 16) return "london";
  if (hour >= 16 && hour < 22) return "new_york";
  return "asia";
}

function spreadState(quote?: NormalizedQuote): MarketContext["spreadState"] {
  if (!quote) return "unknown";
  const basis = quote.symbol.includes("JPY") ? 0.03 : quote.symbol.startsWith("XAU") ? 0.5 : quote.symbol.startsWith("XAG") ? 0.05 : 0.0003;
  if (quote.spread <= basis) return "tight";
  if (quote.spread > basis * 3) return "wide";
  return "normal";
}

function liquidityState(session: MarketSession, quote?: NormalizedQuote): MarketContext["liquidityState"] {
  if (session === "closed") return "closed";
  if (!quote) return "thin";
  if (session === "london_new_york_overlap" && spreadState(quote) !== "wide") return "deep";
  return spreadState(quote) === "wide" ? "thin" : "normal";
}

function volatilityPercentile(candles: NormalizedCandle[]) {
  if (candles.length < 3) return null;
  const ranges = candles.map((candle) => (candle.high - candle.low) / candle.close).sort((a, b) => a - b);
  const latest = (candles[candles.length - 1].high - candles[candles.length - 1].low) / candles[candles.length - 1].close;
  const rank = ranges.filter((value) => value <= latest).length;
  return Number((rank / ranges.length).toFixed(4));
}

function trendRangeRegime(candles: NormalizedCandle[]): MarketContext["trendRangeRegime"] {
  if (candles.length < 5) return "unknown";
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const avgRange = candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
  return Math.abs(last - first) > avgRange * 2 ? "trend" : "range";
}

function proximity(events: MarketContextInput["events"], symbol: string, now: Date, categories: string[]): MarketContext["eventProximity"] {
  const normalized = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  let state: MarketContext["eventProximity"] = "none";
  for (const event of events) {
    if (!categories.includes(event.category)) continue;
    if (event.symbols.length && !event.symbols.some((item) => item.replace(/[^A-Z0-9]/gi, "").toUpperCase() === normalized)) continue;
    const startsAt = Date.parse(event.startsAt);
    const endsAt = Date.parse(event.endsAt ?? event.startsAt);
    const blackoutStart = startsAt - 30 * 60_000;
    const blackoutEnd = endsAt + 30 * 60_000;
    const watchStart = startsAt - 24 * 60 * 60_000;
    if (now.getTime() >= blackoutStart && now.getTime() <= blackoutEnd && ["high", "critical"].includes(event.impact)) return "blackout";
    if (now.getTime() >= watchStart && now.getTime() <= blackoutEnd) state = "watch";
  }
  return state;
}

function dataQuality(quote: NormalizedQuote | undefined, candles: NormalizedCandle[], now: Date, calendarFreshAsOf: string | null): MarketContext["dataQualityState"] {
  const timestamps = [quote?.observedAt, candles[candles.length - 1]?.timestamp, calendarFreshAsOf].filter((value): value is string => Boolean(value));
  if (!timestamps.length) return "missing";
  return timestamps.some((timestamp) => now.getTime() - Date.parse(timestamp) > 24 * 60 * 60_000) ? "stale" : "fresh";
}

function warnings(context: MarketContext, calendarFreshAsOf: string | null, now: Date) {
  return [
    context.dataQualityState !== "fresh" ? `Data quality is ${context.dataQualityState}.` : null,
    context.eventProximity === "blackout" ? "Event blackout window is active." : null,
    context.rollover ? "Rollover conditions are active." : null,
    calendarFreshAsOf && now.getTime() - Date.parse(calendarFreshAsOf) > 24 * 60 * 60_000 ? "Calendar data is stale." : null,
  ].filter((warning): warning is string => Boolean(warning));
}

function changeEvents(context: MarketContext, created: DomainEvent, now: Date) {
  const metadata = { lineage: [{ eventId: created.eventId, eventType: created.eventType, schemaVersion: created.schemaVersion, sourceModule: created.sourceModule, occurredAt: created.occurredAt }] };
  const base = { sourceModule: "market-context" as const, correlationId: created.correlationId, causationId: created.eventId, metadata, occurredAt: now };
  const events: DomainEvent[] = [];
  events.push(createDomainEvent({
    ...base,
    eventType: context.marketOpen ? MarketContextV2EventTypes.MarketSessionOpened : MarketContextV2EventTypes.MarketSessionClosed,
    payload: { contextId: context.contextId, symbol: context.symbol, activeSession: context.activeSession },
  }));
  if (context.liquidityState !== "normal") events.push(createDomainEvent({ ...base, eventType: MarketContextV2EventTypes.LiquidityConditionChanged, payload: { contextId: context.contextId, liquidityState: context.liquidityState } }));
  if (context.volatilityPercentile !== null) events.push(createDomainEvent({ ...base, eventType: MarketContextV2EventTypes.VolatilityRegimeChanged, payload: { contextId: context.contextId, volatilityPercentile: context.volatilityPercentile } }));
  if (context.eventProximity === "blackout") events.push(createDomainEvent({ ...base, eventType: MarketContextV2EventTypes.EventRiskWindowStarted, payload: { contextId: context.contextId, eventProximity: context.eventProximity } }));
  return events;
}

function easternMoment(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[String(values.weekday)] ?? 0,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function isRollover(eastern: ReturnType<typeof easternMoment>) {
  return eastern.hour === 17;
}

function isHoliday(eastern: ReturnType<typeof easternMoment>) {
  const key = `${eastern.month}-${eastern.day}`;
  return ["1-1", "7-4", "12-25"].includes(key);
}

export const marketContextV2Service = new MarketContextV2Service();
