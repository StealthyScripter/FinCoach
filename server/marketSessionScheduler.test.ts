import assert from "node:assert/strict";
import { marketEventImpactScoringService } from "./marketEventImpactScoringService";
import { MarketSnapshotService, nextSnapshotAt } from "./marketSnapshotService";
import { marketSessionsService } from "./marketSessionsService";
import { InMemoryTelegramRepository } from "./telegram/repository";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { loadV2RuntimeConfig } from "./v2/runtime/config";

const originalEnv = { ...process.env };

await weeklyAggregateWaitsForLastConfiguredInstrument();
await individualExchangeCloseDoesNotStopAggregate();
await unknownConfiguredInstrumentFailsClosed();
await continuousMarketMaintenanceApplies();
await snapshotScheduleHandlesDst();
await snapshotDeliveryIsIdempotent();
await impactScoresAreAuditableAndBounded();
await openExchangesCommandIncludesTradableMarkets();
await safetyFlagsRemainBlocked();

process.env = originalEnv;
console.log("market session scheduler tests passed");

async function weeklyAggregateWaitsForLastConfiguredInstrument() {
  setEnv({ FINCOACH_V2_SYMBOLS: "EUR_USD,BTC_USD" });
  const fridayAfterFxClose = new Date("2026-07-31T21:30:00.000Z"); // Friday 5:30 PM New York.
  const aggregate = marketSessionsService.aggregateTradableWindow(fridayAfterFxClose);
  assert.equal(aggregate.anyConfiguredInstrumentTradable, true);
  assert.deepEqual(aggregate.instrumentsRemainingOpen, ["BTC_USD"]);
  assert.equal(aggregate.finalWeeklyCloseAt, "2026-07-31T22:00:00.000Z");
}

async function individualExchangeCloseDoesNotStopAggregate() {
  setEnv({ FINCOACH_V2_SYMBOLS: "EUR_USD,BTC_USD" });
  const fridayAfterFxClose = new Date("2026-07-31T21:30:00.000Z");
  const aggregate = marketSessionsService.aggregateTradableWindow(fridayAfterFxClose);
  assert.equal(aggregate.anyConfiguredInstrumentTradable, true);
  assert.ok(aggregate.instrumentsRemainingOpen.includes("BTC_USD"));
}

async function unknownConfiguredInstrumentFailsClosed() {
  setEnv({ FINCOACH_V2_SYMBOLS: "UNKNOWN_ASSET" });
  const aggregate = marketSessionsService.aggregateTradableWindow(new Date("2026-07-29T12:00:00.000Z"));
  assert.equal(aggregate.anyConfiguredInstrumentTradable, false);
  assert.equal(aggregate.calendarQuality, "unavailable");
}

async function continuousMarketMaintenanceApplies() {
  setEnv({ FINCOACH_V2_SYMBOLS: "BTC_USD", FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_TIME: "18:00", FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_TIME: "17:00" });
  const duringMaintenance = marketSessionsService.aggregateTradableWindow(new Date("2026-07-31T23:30:00.000Z"));
  assert.equal(duringMaintenance.anyConfiguredInstrumentTradable, false);
  assert.equal(duringMaintenance.nextTradableOpenAt, "2026-08-02T21:00:00.000Z");
}

async function snapshotScheduleHandlesDst() {
  const config = loadV2RuntimeConfig().config.marketSnapshot;
  const spring = nextSnapshotAt(config, "morning", new Date("2026-03-08T10:00:00.000Z"));
  const autumn = nextSnapshotAt(config, "morning", new Date("2026-11-01T10:00:00.000Z"));
  assert.equal(spring, "2026-03-08T12:00:00.000Z");
  assert.equal(autumn, "2026-11-01T13:00:00.000Z");
}

async function snapshotDeliveryIsIdempotent() {
  setEnv({ FINCOACH_V2_SYMBOLS: "EUR_USD" });
  const repo = new InMemoryTelegramRepository();
  let sends = 0;
  const notifications = { sendOperations: async () => ({ sent: true as const, result: { delivery: { id: `delivery-${++sends}`, latencyMs: 1, status: "sent" } } }) };
  const service = new MarketSnapshotService(repo, notifications as never);
  const now = new Date("2026-07-31T12:00:00.000Z");
  const first = await service.deliverScheduled("morning", now);
  const second = await service.deliverScheduled("morning", now);
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(sends, 1);
}

async function impactScoresAreAuditableAndBounded() {
  const score = marketEventImpactScoringService.score({
    id: "event-test",
    title: "Central bank decision",
    category: "central_bank",
    impact: "high",
    startsAt: "2026-07-31T14:00:00.000Z",
    relatedAssets: ["EUR_USD", "SPY", "BND"],
    riskNote: "Policy event.",
  }, ["EUR_USD"], new Date("2026-07-31T12:00:00.000Z"));
  assert.ok(score.finalScore >= 1 && score.finalScore <= 10);
  assert.ok(score.explanation.includes("Rule-derived"));
  assert.equal(score.components.confidence, 5);
  assert.deepEqual(score.affectedInstruments, ["EUR_USD"]);
}

async function openExchangesCommandIncludesTradableMarkets() {
  setEnv({ TELEGRAM_ALLOWED_USER_ID: "42", FINCOACH_V2_SYMBOLS: "EUR_USD" });
  const router = new TelegramCommandRouter(process.env, undefined as never, new InMemoryTelegramRepository());
  const message = await router.handle({ command: "/open_exchanges", actorId: "42", chatId: "chat" });
  assert.ok(message.includes("Currently Tradable Markets"));
  assert.ok(message.includes("Live execution: blocked"));
}

async function safetyFlagsRemainBlocked() {
  setEnv({ FINCOACH_LIVE_EXECUTION_ENABLED: "false", FINCOACH_PAPER_EXECUTION_ENABLED: "false", FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: "false" });
  const config = loadV2RuntimeConfig().config;
  assert.equal(config.liveExecutionEnabled, false);
  assert.equal(config.paperExecutionEnabled, false);
  assert.equal(config.demoBrokerExecutionEnabled, false);
}

function setEnv(values: Record<string, string>) {
  const symbols = values.FINCOACH_V2_SYMBOLS ?? values.FINCOACH_V2_OBSERVATION_SYMBOLS ?? "EUR_USD";
  process.env = {
    ...originalEnv,
    DATABASE_URL: undefined,
    FINCOACH_V2_SYMBOLS: symbols,
    FINCOACH_V2_OBSERVATION_SYMBOLS: symbols,
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "true",
    FINCOACH_WEEKLY_RESEARCH_TIMEZONE: "America/New_York",
    FINCOACH_WEEKLY_RESEARCH_OPEN_DAY: "0",
    FINCOACH_WEEKLY_RESEARCH_OPEN_TIME: "17:00",
    FINCOACH_WEEKLY_RESEARCH_CLOSE_DAY: "5",
    FINCOACH_WEEKLY_RESEARCH_CLOSE_TIME: "18:00",
    FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_DAY: "5",
    FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_TIME: "18:00",
    FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_DAY: "0",
    FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_TIME: "17:00",
    ...values,
    FINCOACH_V2_SYMBOLS: symbols,
    FINCOACH_V2_OBSERVATION_SYMBOLS: symbols,
  };
}
