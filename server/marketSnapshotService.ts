import { randomUUID } from "crypto";
import { eventCalendarService, type MarketEvent } from "./eventCalendarService";
import { marketEventImpactScoringService } from "./marketEventImpactScoringService";
import { marketSessionsService } from "./marketSessionsService";
import { providerRegistryService } from "./providerRegistryService";
import { timeSeriesStore } from "./timeSeriesStoreService";
import { loadV2RuntimeConfig, type MarketSnapshotConfig } from "./v2/runtime/config";
import { formatInTimezone } from "./v2/runtime/weeklyResearchWindow";
import { telegramNotificationService, type TelegramNotificationService } from "./telegram/notificationService";
import { telegramRepository, type TelegramRepository } from "./telegram/repository";
import type { MarketSnapshotPeriod, MarketSnapshotRecord } from "./telegram/contracts";

export type FreshnessStatus = {
  status: "fresh" | "delayed" | "stale" | "unavailable";
  latestDataAt: string | null;
  ageSeconds: number | null;
  source: string | null;
};

export type SnapshotDataFreshness = {
  marketPrices: FreshnessStatus;
  economicCalendar: FreshnessStatus;
  news: FreshnessStatus;
  exchangeSessions: FreshnessStatus;
  rates: FreshnessStatus;
  volatility: FreshnessStatus;
};

export class MarketSnapshotService {
  private timer: NodeJS.Timeout | null = null;
  private lastMorningSnapshotAt: string | null = null;
  private lastEveningSnapshotAt: string | null = null;
  private lastDeliveryStatus: string | null = null;

  constructor(
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly notifications: TelegramNotificationService = telegramNotificationService,
  ) {}

  start() {
    const config = loadV2RuntimeConfig().config.marketSnapshot;
    if (!config.enabled || this.timer) return { started: false, reason: config.enabled ? "already_started" : "disabled" };
    this.scheduleNext();
    return { started: true };
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status(now = new Date()) {
    const config = loadV2RuntimeConfig().config.marketSnapshot;
    return {
      enabled: config.enabled,
      timezone: config.timezone,
      nextMorningSnapshotAt: nextSnapshotAt(config, "morning", now),
      nextEveningSnapshotAt: nextSnapshotAt(config, "evening", now),
      lastMorningSnapshotAt: this.lastMorningSnapshotAt,
      lastEveningSnapshotAt: this.lastEveningSnapshotAt,
      lastDeliveryStatus: this.lastDeliveryStatus,
      timerActive: Boolean(this.timer),
    };
  }

  async latest(period?: MarketSnapshotPeriod) {
    return this.repository.latestMarketSnapshot(period);
  }

  async generateOrRetrieve(period: MarketSnapshotPeriod, now = new Date()) {
    const config = loadV2RuntimeConfig().config.marketSnapshot;
    const localDate = localDateKey(now, config.timezone);
    const snapshotId = `market-snapshot:${localDate}:${period}`;
    const existing = await this.repository.latestMarketSnapshot(period);
    if (existing?.snapshotId === snapshotId) return { status: "existing" as const, snapshot: existing };
    const generated = await this.buildSnapshot(period, now, snapshotId, localDate);
    const saved = await this.repository.saveMarketSnapshot(generated);
    return { status: saved.inserted ? "created" as const : "existing" as const, snapshot: saved.record };
  }

  async deliverScheduled(period: MarketSnapshotPeriod, now = new Date()) {
    const result = await this.generateOrRetrieve(period, now);
    if (result.snapshot.deliveryStatus === "delivered") {
      this.lastDeliveryStatus = "delivered";
      return { sent: false, reason: "snapshot_already_delivered", snapshotId: result.snapshot.snapshotId };
    }
    const delivery = await this.notifications.sendOperations("report", result.snapshot.message, { snapshotId: result.snapshot.snapshotId, period, liveExecutionBlocked: true });
    const deliveryId = delivery.sent && "result" in delivery ? delivery.result.delivery.id : null;
    await this.repository.markMarketSnapshotDelivered(result.snapshot.snapshotId, { deliveryId, deliveryStatus: delivery.sent ? "delivered" : "failed" });
    this.lastDeliveryStatus = delivery.sent ? "sent" : "failed";
    if (period === "morning") this.lastMorningSnapshotAt = now.toISOString();
    else this.lastEveningSnapshotAt = now.toISOString();
    return { sent: delivery.sent, snapshotId: result.snapshot.snapshotId, deliveryId };
  }

  upcomingEvents(now = new Date(), input: { lookaheadHours?: number; minimumImpact?: number; limit?: number } = {}) {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const lookaheadHours = Math.min(168, Math.max(1, input.lookaheadHours ?? runtimeConfig.marketSnapshot.lookaheadHours));
    const minimumImpact = Math.min(10, Math.max(1, input.minimumImpact ?? 1));
    const limit = Math.min(50, Math.max(1, input.limit ?? runtimeConfig.marketSnapshot.maxEvents));
    const cutoff = now.getTime() + lookaheadHours * 3_600_000;
    return eventCalendarService.getUpcomingEvents(now)
      .filter((event) => Date.parse(event.startsAt) <= cutoff)
      .map((event) => ({ event, impactScore: marketEventImpactScoringService.score(event, runtimeConfig.symbols, now), source: "eventCalendarService.demo_or_configured" }))
      .filter((item) => item.impactScore.finalScore >= minimumImpact)
      .sort((a, b) => b.impactScore.finalScore - a.impactScore.finalScore || a.event.startsAt.localeCompare(b.event.startsAt))
      .slice(0, limit);
  }

  private async buildSnapshot(period: MarketSnapshotPeriod, now: Date, snapshotId: string, localDate: string): Promise<MarketSnapshotRecord> {
    const runtimeConfig = loadV2RuntimeConfig().config;
    const config = runtimeConfig.marketSnapshot;
    const generatedAt = now.toISOString();
    const marketSessions = marketSessionsService.marketSessions(now);
    const events = this.upcomingEvents(now, { lookaheadHours: config.lookaheadHours, limit: config.maxEvents });
    const freshness = await this.freshness(now);
    const blockers = Object.entries(freshness).filter(([, value]) => value.status === "stale" || value.status === "unavailable").map(([key, value]) => `${key}: ${value.status}`);
    const payload = {
      schemaVersion: "fincoach.v2.market-snapshot.1",
      snapshotId,
      period,
      generatedAt,
      timezone: config.timezone,
      marketSessions,
      events,
      freshness,
      blockers,
      providerHealth: providerRegistryService.getSnapshot().providers.map((provider) => ({ id: provider.id, status: provider.status })),
      liveExecutionBlocked: true,
    };
    const message = this.formatMessage(period, now, marketSessions, events, freshness, blockers, config);
    return {
      snapshotId,
      period,
      scheduledLocalDate: localDate,
      scheduledLocalTime: period === "morning" ? config.morningTime : config.eveningTime,
      generatedAt,
      timezone: config.timezone,
      payload,
      message,
      deliveryId: null,
      deliveryStatus: "pending",
      schemaVersion: "fincoach.v2.market-snapshot.1",
      correlationId: randomUUID(),
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
  }

  private async freshness(now: Date): Promise<SnapshotDataFreshness> {
    const [prices, economic, options] = await Promise.all([
      timeSeriesStore.listPriceBars(1).catch(() => []),
      timeSeriesStore.listEconomicObservations(1).catch(() => []),
      timeSeriesStore.listOptionsSnapshots(1).catch(() => []),
    ]);
    return {
      marketPrices: freshnessFromTimestamp(prices[0]?.timestamp, now, prices[0] ? "timeSeriesStore" : null, 15 * 60),
      economicCalendar: { status: "delayed", latestDataAt: now.toISOString(), ageSeconds: 0, source: "eventCalendarService demo/configured fallback" },
      news: { status: "unavailable", latestDataAt: null, ageSeconds: null, source: null },
      exchangeSessions: { status: "fresh", latestDataAt: now.toISOString(), ageSeconds: 0, source: "marketSessionRulesService" },
      rates: freshnessFromTimestamp(economic[0]?.timestamp, now, economic[0] ? "timeSeriesStore economic observations" : null, 24 * 3_600),
      volatility: freshnessFromTimestamp(options[0]?.timestamp, now, options[0] ? "timeSeriesStore options snapshots" : null, 3_600),
    };
  }

  private formatMessage(period: MarketSnapshotPeriod, now: Date, marketSessions: Record<string, unknown>, events: ReturnType<MarketSnapshotService["upcomingEvents"]>, freshness: SnapshotDataFreshness, blockers: string[], config: MarketSnapshotConfig) {
    const aggregate = marketSessions.aggregateTradableWindow as { openExchanges?: unknown[]; openInstrumentSessions?: unknown[]; nextTradableOpenAt?: string | null; finalWeeklyCloseAt?: string | null; anyConfiguredInstrumentTradable?: boolean };
    const eventLines = events.length ? events.map((item, index) => [
      `${index + 1}. ${item.event.title}`,
      `   Time: ${formatInTimezone(item.event.startsAt, config.timezone)} ${config.timezone}`,
      `   Region/instruments: ${item.impactScore.affectedInstruments.join(", ") || item.event.relatedAssets.join(", ") || "unavailable"}`,
      `   Impact: ${item.impactScore.finalScore}/10`,
      `   Why it matters: ${item.event.riskNote}`,
      "   Consensus/previous: unavailable",
      "   Main execution risk: volatility, spread, liquidity, or gap risk depending on instrument.",
    ].join("\n")).join("\n") : "No upcoming configured/demo calendar events in lookahead window.";
    return [
      `📊 Market Snapshot — ${period === "morning" ? "Morning" : "Evening"}`,
      `${formatInTimezone(now, config.timezone)} ${config.timezone}`,
      "",
      "Market State",
      `• Open exchanges: ${(aggregate.openExchanges ?? []).length}`,
      `• Open instrument sessions: ${(aggregate.openInstrumentSessions ?? []).length}`,
      `• Next major open/close: ${aggregate.anyConfiguredInstrumentTradable ? aggregate.finalWeeklyCloseAt ?? "unavailable" : aggregate.nextTradableOpenAt ?? "unavailable"}`,
      `• Research scheduler: ${aggregate.anyConfiguredInstrumentTradable ? "active" : "suspended"}`,
      "• Live execution: blocked",
      "",
      "Cross-Asset Conditions",
      "• FX: live movement data unavailable; session state derived from configured calendar.",
      "• Equities: live index/breadth data unavailable.",
      "• Commodities: live oil/gold data unavailable; configured session state only.",
      "• Rates: latest yield observations unavailable unless time-series ingestion is populated.",
      "• Volatility: volatility feed unavailable unless options snapshots are populated.",
      "• Crypto: shown only when configured; live market data unavailable.",
      "• Risk tone: unavailable; insufficient fresh cross-asset data.",
      "",
      "Upcoming High-Impact Events",
      eventLines,
      "",
      "Operational Readiness",
      `• Data freshness: ${blockers.length ? "degraded" : "healthy"}`,
      `• Missing feeds: ${blockers.join(", ") || "none"}`,
      `• Active blockers: ${blockers.join(", ") || "none"}`,
      "• Existing signals: unavailable in snapshot context",
      "• Forward tests: unavailable in snapshot context",
      "• Live execution: blocked",
    ].join("\n").slice(0, 3900);
  }

  private scheduleNext() {
    const config = loadV2RuntimeConfig().config.marketSnapshot;
    const now = new Date();
    const next = [nextSnapshotAt(config, "morning", now), nextSnapshotAt(config, "evening", now)].sort()[0];
    const delay = Math.max(1_000, Math.min(Date.parse(next) - now.getTime(), 2_147_000_000));
    this.timer = setTimeout(() => {
      this.timer = null;
      const period = next.endsWith(`T${config.morningTime}:00.000Z`) ? "morning" : periodForLocalTime(new Date(next), config);
      void this.deliverScheduled(period).finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }
}

export function nextSnapshotAt(config: MarketSnapshotConfig, period: MarketSnapshotPeriod, now = new Date()) {
  const time = period === "morning" ? config.morningTime : config.eveningTime;
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = zonedLocalDateAtOffset(now, config.timezone, offset, time);
    if (!config.includeWeekends && [0, 6].includes(localWeekday(candidate, config.timezone))) continue;
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return new Date(now.getTime() + 24 * 3_600_000).toISOString();
}

function periodForLocalTime(date: Date, config: MarketSnapshotConfig): MarketSnapshotPeriod {
  const local = localTime(date, config.timezone);
  return local <= config.morningTime ? "morning" : "evening";
}

function zonedLocalDateAtOffset(now: Date, timezone: string, offsetDays: number, time: string) {
  const dateKey = localDateKey(new Date(now.getTime() + offsetDays * 24 * 3_600_000), timezone);
  return zonedTimeToUtc(`${dateKey}T${time}`, timezone);
}

function zonedTimeToUtc(localIso: string, timezone: string) {
  const [date, time] = localIso.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let index = 0; index < 4; index += 1) {
    const parts = localParts(new Date(guess), timezone);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = actual - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

function localDateKey(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localTime(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function localWeekday(date: Date, timezone: string) {
  return localParts(date, timezone).weekday;
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[String(values.weekday)] ?? 0, hour: Number(values.hour), minute: Number(values.minute) };
}

function freshnessFromTimestamp(timestamp: string | undefined, now: Date, source: string | null, freshSeconds: number): FreshnessStatus {
  if (!timestamp) return { status: "unavailable", latestDataAt: null, ageSeconds: null, source };
  const ageSeconds = Math.max(0, Math.round((now.getTime() - Date.parse(timestamp)) / 1000));
  return { status: ageSeconds <= freshSeconds ? "fresh" : ageSeconds <= freshSeconds * 4 ? "delayed" : "stale", latestDataAt: timestamp, ageSeconds, source };
}

export const marketSnapshotService = new MarketSnapshotService();
