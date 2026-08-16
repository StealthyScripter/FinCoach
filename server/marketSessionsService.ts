import { marketSessionRulesService } from "./execution/marketSessionRules";
import { resolveResearchInstrument, validateResearchUniverse } from "./v2/researchUniverse";
import { fxResearchSessions } from "./v2/fxResearchSessions";
import { loadV2RuntimeConfig, type ContinuousMarketWeeklyPauseConfig } from "./v2/runtime/config";
import { formatInTimezone, weeklyResearchWindowState } from "./v2/runtime/weeklyResearchWindow";

export type MarketSessionStatus = "open" | "closed" | "degraded";
export type InstrumentGroup = "fx" | "equities" | "commodities" | "futures" | "rates" | "crypto" | "other";
export type CalendarQuality = "authoritative" | "partial" | "fallback" | "unavailable";

export type ExchangeSessionStatus = {
  exchangeId: string;
  name: string;
  status: MarketSessionStatus;
  openedAt: string | null;
  closesAt: string | null;
  nextOpensAt: string | null;
  symbols: string[];
  calendarQuality: CalendarQuality;
  source: "marketSessionRulesService" | "configured_session_metadata" | "continuous_market_policy" | "unavailable";
  degradationReason?: string;
};

export type InstrumentSessionStatus = {
  symbol: string;
  displaySymbol: string;
  group: InstrumentGroup;
  venue: string;
  status: MarketSessionStatus;
  openedAt: string | null;
  closesAt: string | null;
  nextOpensAt: string | null;
  calendarQuality: CalendarQuality;
  source: ExchangeSessionStatus["source"];
  reason?: string;
};

export type AggregateTradableWindow = {
  anyConfiguredInstrumentTradable: boolean;
  openExchanges: ExchangeSessionStatus[];
  openInstrumentSessions: InstrumentSessionStatus[];
  nextTradableOpenAt: string | null;
  finalWeeklyCloseAt: string | null;
  instrumentsRemainingOpen: string[];
  calendarQuality: CalendarQuality;
};

const MAX_TELEGRAM_LENGTH = 3600;

export class MarketSessionsService {
  marketSessions(now = new Date()) {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const aggregate = this.aggregateTradableWindow(now);
    const grouped = groupInstrumentSessions(this.instrumentSessions(runtimeConfig.symbols, now));
    const weekly = weeklyResearchWindowState(runtimeConfig.weeklyResearchSchedule, now);
    return {
      schemaVersion: "fincoach.v2.market-sessions.1",
      generatedAt: now.toISOString(),
      timezone: runtimeConfig.weeklyResearchSchedule.timezone,
      weeklyResearchWindow: {
        isOpen: aggregate.anyConfiguredInstrumentTradable,
        isStartLeadWindow: isInsideStartLead(runtimeConfig.weeklyResearchSchedule.startLeadMinutes, aggregate.nextTradableOpenAt, now),
        openedAt: aggregate.openInstrumentSessions[0]?.openedAt ?? weekly.currentWindowOpenedAt,
        closesAt: aggregate.finalWeeklyCloseAt,
        nextOpensAt: aggregate.nextTradableOpenAt,
        nextClosesAt: aggregate.finalWeeklyCloseAt,
      },
      researchScheduler: {
        state: aggregate.anyConfiguredInstrumentTradable ? "running" : "scheduled_closed",
        active: aggregate.anyConfiguredInstrumentTradable,
      },
      aggregateTradableWindow: aggregate,
      researchUniverse: validateResearchUniverse(runtimeConfig.symbols),
      anyConfiguredInstrumentTradable: aggregate.anyConfiguredInstrumentTradable,
      finalWeeklyCloseAt: aggregate.finalWeeklyCloseAt,
      nextTradableOpenAt: aggregate.nextTradableOpenAt,
      instrumentsRemainingOpen: aggregate.instrumentsRemainingOpen,
      calendarQuality: aggregate.calendarQuality,
      exchanges: this.exchangeSessions(runtimeConfig.symbols, now),
      instrumentSessions: this.instrumentSessions(runtimeConfig.symbols, now),
      groupedInstrumentSessions: grouped,
      fxResearchSessions: fxResearchSessions(now, runtimeConfig.symbols),
      liveExecutionBlocked: true,
    };
  }

  aggregateTradableWindow(now = new Date(), configuredSymbols?: string[]): AggregateTradableWindow {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const symbols = configuredSymbols ?? runtimeConfig.symbols;
    const sessions = this.instrumentSessions(symbols, now);
    const openInstrumentSessions = sessions.filter((session) => session.status === "open");
    const openExchanges = this.exchangeSessions(symbols, now).filter((exchange) => exchange.status === "open");
    const nextTradableOpenAt = minIso(sessions.map((session) => session.status === "open" ? null : session.nextOpensAt));
    const finalWeeklyCloseAt = maxIso(openInstrumentSessions.map((session) => session.closesAt));
    return {
      anyConfiguredInstrumentTradable: openInstrumentSessions.length > 0,
      openExchanges,
      openInstrumentSessions,
      nextTradableOpenAt,
      finalWeeklyCloseAt,
      instrumentsRemainingOpen: openInstrumentSessions.map((session) => session.symbol).sort(),
      calendarQuality: aggregateQuality(sessions.map((session) => session.calendarQuality)),
    };
  }

  exchangeSessions(configuredSymbols: string[], now = new Date()): ExchangeSessionStatus[] {
    const sessions = this.instrumentSessions(configuredSymbols, now);
    const byVenue = new Map<string, ExchangeSessionStatus>();
    for (const session of sessions) {
      const current = byVenue.get(session.venue) ?? {
        exchangeId: session.venue.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: session.venue,
        status: "closed" as const,
        openedAt: null,
        closesAt: null,
        nextOpensAt: null,
        symbols: [],
        calendarQuality: session.calendarQuality,
        source: session.source,
        degradationReason: session.reason,
      };
      current.symbols.push(session.symbol);
      current.calendarQuality = aggregateQuality([current.calendarQuality, session.calendarQuality]);
      if (session.status === "open") {
        current.status = "open";
        current.openedAt = minIso([current.openedAt, session.openedAt]);
        current.closesAt = maxIso([current.closesAt, session.closesAt]);
      } else if (current.status !== "open") {
        current.nextOpensAt = minIso([current.nextOpensAt, session.nextOpensAt]);
      }
      byVenue.set(session.venue, current);
    }
    return [...byVenue.values()].map((exchange) => ({ ...exchange, symbols: [...new Set(exchange.symbols)].sort() }))
      .sort((a, b) => (a.closesAt ?? a.nextOpensAt ?? "").localeCompare(b.closesAt ?? b.nextOpensAt ?? "") || a.name.localeCompare(b.name));
  }

  instrumentSessions(configuredSymbols: string[], now = new Date()): InstrumentSessionStatus[] {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const symbols = configuredSymbols.length ? configuredSymbols : runtimeConfig.symbols;
    return symbols.map((symbol) => this.instrumentSession(symbol, now, runtimeConfig.continuousMarketWeeklyPause));
  }

  openExchangesTelegramMessage(now = new Date()) {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const aggregate = this.aggregateTradableWindow(now);
    const groups = groupInstrumentSessions(this.instrumentSessions(runtimeConfig.symbols, now));
    const lines = [
      "Currently Tradable Markets",
      `As of: ${formatInTimezone(now, runtimeConfig.weeklyResearchSchedule.timezone)} ${runtimeConfig.weeklyResearchSchedule.timezone}`,
      "",
    ];
    if (!aggregate.anyConfiguredInstrumentTradable) {
      lines.push("No configured instruments are currently tradable.", "");
      if (aggregate.nextTradableOpenAt) {
        lines.push("Next configured tradable opening:");
        lines.push(`${formatInTimezone(aggregate.nextTradableOpenAt, runtimeConfig.weeklyResearchSchedule.timezone, false)} ${runtimeConfig.weeklyResearchSchedule.timezone}`);
        lines.push("");
      }
      lines.push("Research scheduler: suspended", "Live execution: blocked");
      return lines.join("\n");
    }
    for (const group of ["fx", "equities", "commodities", "futures", "rates", "crypto", "other"] as InstrumentGroup[]) {
      const sessions = (groups[group] ?? []).filter((session) => session.status === "open");
      if (!sessions.length) continue;
      lines.push(groupLabel(group));
      for (const session of sessions) {
        lines.push(`- ${session.name}: ${session.symbols.join(", ")}`);
        if (session.closesAt) lines.push(`  Next close/maintenance: ${formatInTimezone(session.closesAt, runtimeConfig.weeklyResearchSchedule.timezone, false)} ${runtimeConfig.weeklyResearchSchedule.timezone}`);
        lines.push(`  Calendar: ${session.calendarQuality}`);
      }
      lines.push("");
    }
    lines.push(`Research scheduler: ${aggregate.anyConfiguredInstrumentTradable ? "active" : "suspended"}`, "Live execution: blocked");
    const message = lines.join("\n").trim();
    return message.length <= MAX_TELEGRAM_LENGTH ? message : `${message.slice(0, MAX_TELEGRAM_LENGTH - 80)}\n\nAdditional sessions truncated for Telegram limit.`;
  }

  private instrumentSession(symbol: string, now: Date, continuousPolicy: ContinuousMarketWeeklyPauseConfig): InstrumentSessionStatus {
    const normalized = symbol.trim().toUpperCase();
    if (isCryptoSymbol(normalized)) return cryptoSession(normalized, now, continuousPolicy);
    const known = resolveResearchInstrument(symbol);
    if (!known) {
      return {
        symbol: normalized,
        displaySymbol: normalized,
        group: "other",
        venue: "Unknown configured instrument",
        status: "closed",
        openedAt: null,
        closesAt: null,
        nextOpensAt: null,
        calendarQuality: "unavailable",
        source: "unavailable",
        reason: "Configured instrument has no session metadata; failing closed.",
      };
    }
    const assetClass = known.assetClass;
    const evaluated = marketSessionRulesService.evaluate({
      assetClass,
      now,
      accountEquity: 100_000,
      currentMarginUsed: 0,
      projectedMarginUsed: 0,
      positionHeldOvernight: false,
      financingAcknowledged: false,
    });
    const weekly = weeklyTemplate(assetClass);
    const state = weeklyResearchWindowState(weekly, now);
    return {
      symbol: known.symbol,
      displaySymbol: known.displaySymbol,
      group: assetClass === "forex" ? "fx" : "commodities",
      venue: known.venue,
      status: evaluated.marketHoursOpen ? "open" : "closed",
      openedAt: evaluated.marketHoursOpen ? state.currentWindowOpenedAt : null,
      closesAt: evaluated.marketHoursOpen ? state.currentWindowClosesAt : null,
      nextOpensAt: evaluated.marketHoursOpen ? null : state.nextWindowOpensAt,
      calendarQuality: "partial",
      source: "marketSessionRulesService",
      reason: evaluated.holiday ? "Holiday support is limited to built-in US market holidays." : undefined,
    };
  }
}

function weeklyTemplate(assetClass: "forex" | "commodity") {
  return assetClass === "forex"
    ? { enabled: true, timezone: "UTC", openDay: 0, openTime: "21:00", closeDay: 5, closeTime: "21:00", startLeadMinutes: 0 }
    : { enabled: true, timezone: "UTC", openDay: 0, openTime: "21:00", closeDay: 5, closeTime: "21:00", startLeadMinutes: 0 };
}

function cryptoSession(symbol: string, now: Date, policy: ContinuousMarketWeeklyPauseConfig): InstrumentSessionStatus {
  const maintenance = weeklyResearchWindowState({
    enabled: policy.enabled,
    timezone: policy.timezone,
    openDay: policy.resumeDay,
    openTime: policy.resumeTime,
    closeDay: policy.pauseDay,
    closeTime: policy.pauseTime,
    startLeadMinutes: 0,
  }, now);
  const open = !policy.enabled || maintenance.isResearchWindowOpen;
  return {
    symbol,
    displaySymbol: symbol,
    group: "crypto",
    venue: "Continuous Crypto",
    status: open ? "open" : "closed",
    openedAt: open ? maintenance.currentWindowOpenedAt : null,
    closesAt: open ? maintenance.currentWindowClosesAt : null,
    nextOpensAt: open ? null : maintenance.nextWindowOpensAt,
    calendarQuality: "fallback",
    source: "continuous_market_policy",
    reason: "Continuous-market maintenance is operator-defined, not an exchange holiday calendar.",
  };
}

function isCryptoSymbol(symbol: string) {
  return /^(BTC|ETH|SOL|XRP|DOGE|ADA|BNB|AVAX)([_/-]?USD|USDT)?$/.test(symbol);
}

function groupInstrumentSessions(sessions: InstrumentSessionStatus[]) {
  const grouped: Partial<Record<InstrumentGroup, Array<ExchangeSessionStatus & { group: InstrumentGroup }>>> = {};
  for (const session of sessions) {
    const list = grouped[session.group] ?? [];
    const current = list.find((item) => item.name === session.venue) ?? {
      group: session.group,
      exchangeId: session.venue.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: session.venue,
      status: "closed" as const,
      openedAt: null,
      closesAt: null,
      nextOpensAt: null,
      symbols: [],
      calendarQuality: session.calendarQuality,
      source: session.source,
      degradationReason: session.reason,
    };
    current.symbols.push(session.symbol);
    current.calendarQuality = aggregateQuality([current.calendarQuality, session.calendarQuality]);
    if (session.status === "open") {
      current.status = "open";
      current.openedAt = minIso([current.openedAt, session.openedAt]);
      current.closesAt = maxIso([current.closesAt, session.closesAt]);
    } else if (current.status !== "open") {
      current.nextOpensAt = minIso([current.nextOpensAt, session.nextOpensAt]);
    }
    if (!list.includes(current)) list.push(current);
    grouped[session.group] = list;
  }
  return grouped;
}

function isInsideStartLead(minutes: number, nextOpenAt: string | null, now: Date) {
  if (!nextOpenAt || minutes <= 0) return false;
  const delta = Date.parse(nextOpenAt) - now.getTime();
  return delta > 0 && delta <= minutes * 60_000;
}

function minIso(values: Array<string | null | undefined>) {
  const sorted = values.filter((value): value is string => Boolean(value)).sort();
  return sorted[0] ?? null;
}

function maxIso(values: Array<string | null | undefined>) {
  const sorted = values.filter((value): value is string => Boolean(value)).sort();
  return sorted.at(-1) ?? null;
}

function aggregateQuality(values: CalendarQuality[]): CalendarQuality {
  if (values.includes("unavailable")) return "unavailable";
  if (values.includes("fallback")) return "fallback";
  if (values.includes("partial")) return "partial";
  return "authoritative";
}

function groupLabel(group: InstrumentGroup) {
  return ({ fx: "FX", equities: "Equities", commodities: "Commodities", futures: "Futures", rates: "Rates", crypto: "Crypto", other: "Other Configured Securities" } satisfies Record<InstrumentGroup, string>)[group];
}

export const marketSessionsService = new MarketSessionsService();
