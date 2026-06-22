import assert from "node:assert/strict";
import { CandleBuilderService, type Candle } from "./execution/candleBuilderService";
import { EconomicEventRiskService } from "./execution/economicEventRiskService";
import { EventLogService } from "./eventLogService";
import { MarketDataMetrics } from "./execution/marketDataMetrics";
import { PaperStrategyRuntime } from "./execution/paperStrategyRuntime";
import { PostTradeReviewService } from "./execution/postTradeReviewService";
import { PredictionReviewService } from "./predictionReviewService";
import {
  BrokerPollingPriceProvider,
  DemoPriceFeedProvider,
  PriceFeedService,
  type StreamingPriceProvider,
} from "./execution/priceFeedService";
import { ExecutionAuditLog, ExecutionRiskService } from "./execution/riskControls";
import { ExecutionRiskPrecheckService } from "./execution/riskPrecheck";
import { SignalQualityFilter } from "./execution/signalQuality";
import { StrategyAdaptationService } from "./execution/strategyAdaptationService";
import { StrategyOpsService } from "./execution/strategyOpsService";
import { TradeLifecycleService } from "./execution/tradeLifecycle";
import { selectStrategyPerformanceDashboard } from "./execution/strategyPerformanceDashboard";
import type { DemoBrokerAdapter } from "./execution/brokerSandbox";
import { AUTOMATION_LEVEL_ACKNOWLEDGEMENT, AutomationLevelService } from "./execution/automationLevels";

const events = new EventLogService();
const audit = new ExecutionAuditLog();
const metrics = new MarketDataMetrics();
const feed = new PriceFeedService({ agingAfterMs: 1_000, staleAfterMs: 2_000 }, events, audit, metrics);
const fresh = feed.ingest({
  symbol: "EUR_USD",
  bid: 1.1,
  ask: 1.1002,
  mid: 1.1001,
  timestamp: "2026-06-19T12:00:00.000Z",
  provider: "test",
}, new Date("2026-06-19T12:00:00.500Z"));
assert.equal(fresh.symbol, "EUR/USD");
assert.equal(fresh.spread, 0.0002);
assert.equal(fresh.freshness, "fresh");
assert.equal(feed.getLatest("EUR/USD", new Date("2026-06-19T12:00:01.500Z"))?.freshness, "aging");
assert.equal(feed.getLatest("EUR/USD", new Date("2026-06-19T12:00:03.000Z"))?.freshness, "stale");
assert.equal(feed.ingest({
  symbol: "EUR/USD",
  bid: 1.1,
  ask: 1.1002,
  mid: 1.1001,
  timestamp: "2026-06-19T11:59:00.000Z",
  provider: "test",
}, new Date("2026-06-19T12:00:00.000Z")).confidence, 20);
assert.equal(metrics.snapshot().staleTicks, 1);
assert.equal(events.countByType("price.tick_received"), 2);

const demoFeed = new DemoPriceFeedProvider({ "EUR/USD": 1.2 });
assert.equal((await feed.poll(demoFeed, "EUR/USD")).provider, "demo_price_feed");
let streamed = false;
const streaming: StreamingPriceProvider = {
  id: "fake_stream",
  async subscribe(_symbols, onTick) {
    onTick({
      symbol: "XAU/USD",
      bid: 2350,
      ask: 2350.1,
      mid: 2350.05,
      timestamp: new Date().toISOString(),
      provider: "fake_stream",
    });
    streamed = true;
    return () => undefined;
  },
};
await feed.connect(streaming, ["XAU/USD"]);
assert.equal(streamed, true);
assert.equal(feed.getLatest("XAU/USD")?.provider, "fake_stream");

const brokerPricing = new BrokerPollingPriceProvider({
  id: "oanda_practice",
  environment: "practice",
  productionOrderSubmissionEnabled: false,
  async getPricingSnapshot() {
    return {
      provider: "oanda_practice",
      internalSymbol: "EUR/USD",
      providerSymbol: "EUR_USD",
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      status: "tradeable",
      asOf: new Date().toISOString(),
      stale: false,
    };
  },
} as DemoBrokerAdapter);
assert.equal((await brokerPricing.getPrice("EUR/USD")).provider, "oanda_practice");

const candleEvents = new EventLogService();
const candleMetrics = new MarketDataMetrics();
const candles = new CandleBuilderService(candleEvents, new ExecutionAuditLog(), candleMetrics);
const firstTick = {
  ...fresh,
  timestamp: "2026-06-19T12:00:10.000Z",
  mid: 1.1,
};
candles.ingest(firstTick, "1m", 2);
candles.ingest({ ...firstTick, timestamp: "2026-06-19T12:00:40.000Z", mid: 1.101 }, "1m", 3);
const rolled = candles.ingest({ ...firstTick, timestamp: "2026-06-19T12:01:00.000Z", mid: 1.102 }, "1m", 1);
assert.equal(rolled.completed.length, 1);
assert.deepEqual(
  { open: rolled.completed[0].open, high: rolled.completed[0].high, low: rolled.completed[0].low, close: rolled.completed[0].close, volume: rolled.completed[0].volume },
  { open: 1.1, high: 1.101, low: 1.1, close: 1.101, volume: 5 },
);
assert.equal(candleEvents.countByType("market.candle_closed"), 1);
assert.equal(candleMetrics.snapshot().candlesClosed, 1);
for (const timeframe of ["1m", "5m", "15m", "1h", "4h", "1d"] as const) {
  assert.ok(candles.ingest(firstTick, timeframe).active);
}

const eventRisk = new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog());
eventRisk.configure({
  type: "CPI",
  title: "US CPI",
  startsAt: "2026-06-19T12:30:00.000Z",
  endsAt: "2026-06-19T12:31:00.000Z",
  severity: "high",
  symbols: ["EUR/USD"],
  assetClasses: ["forex"],
  notes: "Manual test event",
  enabled: true,
});
assert.equal(eventRisk.evaluate("EUR/USD", {
  enabled: true,
  blockSeverities: ["high"],
  warnSeverities: ["medium"],
  minutesBefore: 30,
  minutesAfter: 30,
}, new Date("2026-06-19T12:15:00.000Z")).action, "block");
assert.equal(eventRisk.evaluate("WTI", {
  enabled: true,
  blockSeverities: ["critical"],
  warnSeverities: ["high"],
  minutesBefore: 30,
  minutesAfter: 30,
}, new Date("2026-06-19T12:15:00.000Z")).action, "allow");

const runtimeRisk = new ExecutionRiskService();
const runtimeAudit = new ExecutionAuditLog();
const runtimeMetrics = new MarketDataMetrics();
const runtime = new PaperStrategyRuntime(
  runtimeRisk,
  runtimeAudit,
  new TradeLifecycleService(),
  new EventLogService(),
  runtimeMetrics,
);
runtime.configure({
  strategyId: "paper-v4",
  name: "Paper v4",
  allowedSymbols: ["EUR/USD"],
  maxTradesPerDay: 2,
  maxOpenPositions: 1,
  session: { startHourUtc: 0, endHourUtc: 0 },
  defaultStopDistance: 0.001,
  defaultTakeProfitDistance: 0.002,
  trailingStopDistance: 0.0005,
});
runtime.start("paper-v4");
const position = runtime.open({
  strategyId: "paper-v4",
  symbol: "EUR/USD",
  side: "buy",
  units: 10_000,
  price: 1.1,
  thesis: "Bullish continuation",
  entryReason: "Closed above range",
  expectedMove: "20 pips higher",
}, new Date("2026-06-19T12:00:00.000Z"));
assert.equal(runtime.listOpen().length, 1);
assert.throws(() => runtime.open({
  strategyId: "paper-v4",
  symbol: "EUR/USD",
  side: "buy",
  units: 1,
  price: 1.1,
  thesis: "duplicate",
  entryReason: "duplicate",
  expectedMove: "duplicate",
}), /maximum open positions/);
runtime.onTick({ ...fresh, timestamp: "2026-06-19T12:01:00.000Z", bid: 1.1016, ask: 1.1018, mid: 1.1017 });
const closed = runtime.onTick({ ...fresh, timestamp: "2026-06-19T12:02:00.000Z", bid: 1.1011, ask: 1.1013, mid: 1.1012 });
assert.equal(closed.length, 1);
assert.equal(closed[0].exitReason, "trailing_stop");
assert.ok(closed[0].realizedPnL > 0);
assert.equal(runtime.listOpen().length, 0);
assert.equal(runtime.journal().length, 2);

const adaptations = new StrategyAdaptationService(new ExecutionAuditLog());
const reviewEvents = new EventLogService();
const reviewMetrics = new MarketDataMetrics();
const reviews = new PostTradeReviewService(
  new PredictionReviewService(),
  adaptations,
  reviewEvents,
  new ExecutionAuditLog(),
  reviewMetrics,
);
const review = reviews.reviewPaperTrade(closed[0], ["Session liquidity was weaker than expected"]);
assert.equal(review.tradeId, position.id);
assert.equal(review.result, "win");
assert.ok(review.originalThesis.length > 0);
assert.ok(review.entryReason.length > 0);
assert.ok(review.exitReason.length > 0);
assert.ok(review.updatedLesson.length > 0);
assert.ok(review.proficiencyGraphUpdates.length > 0);
assert.equal(review.strategyValidationScoreDelta, 1);
assert.equal(reviewEvents.countByType("post_trade.review_completed"), 1);
assert.equal(reviewMetrics.snapshot().postTradeReviews, 1);
assert.ok(adaptations.list().every((suggestion) => suggestion.automaticallyApplied === false && suggestion.status === "pending_human_approval"));
const reviewedSuggestion = adaptations.review(adaptations.list()[0].id, "approved", "human-reviewer");
assert.equal(reviewedSuggestion.status, "approved");
assert.equal(reviewedSuggestion.automaticallyApplied, false);

const opsRuntime = new PaperStrategyRuntime(
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new TradeLifecycleService(),
  new EventLogService(),
  new MarketDataMetrics(),
  new AutomationLevelService(4),
);
opsRuntime.configure({
  strategyId: "ops-v4",
  name: "Ops v4",
  allowedSymbols: ["EUR/USD"],
  maxTradesPerDay: 3,
  maxOpenPositions: 2,
  session: { startHourUtc: 0, endHourUtc: 0 },
  defaultStopDistance: 0.001,
  defaultTakeProfitDistance: 0.002,
  trailingStopDistance: null,
});
opsRuntime.start("ops-v4");
const ops = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog()),
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
  new AutomationLevelService(4),
);
ops.subscribe({
  id: "ops-v4",
  name: "Ops v4",
  symbols: ["EUR/USD"],
  timeframe: "1m",
  route: "paper",
  enabled: true,
  units: 1_000,
  evaluate: () => ({
    candidate: true,
    side: "buy",
    confidence: 85,
    thesis: "Bullish candle",
    entryReason: "Rule matched",
    expectedMove: "Continuation",
    stopLoss: 1.099,
    takeProfit: 1.103,
  }),
  quality: () => ({
    sourceReliability: 90,
    strategyValidationScore: 90,
    timeframeQuality: 90,
    trendAlignment: 90,
    volatilityRegime: 90,
    spreadLiquidityCondition: 90,
    recentFalseSignalRate: 5,
    newsRisk: 5,
    riskRewardRatio: 2,
  }),
  riskContext: () => healthyRiskContext(),
});
const opsResult = await ops.onCandle(testCandle());
assert.equal(opsResult[0].status, "paper_opened");
assert.equal(opsRuntime.listOpen().length, 1);
assert.equal(ops.listSignals().length, 1);

const signalOnlyOps = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog()),
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
  new AutomationLevelService(1),
);
signalOnlyOps.subscribe(testOperationalStrategy("signal-only", "paper"));
assert.equal((await signalOnlyOps.onCandle(testCandle()))[0].status, "signal_only");
assert.equal(opsRuntime.listOpen().length, 1);

const disabledOps = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog()),
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
  new AutomationLevelService(0),
);
disabledOps.subscribe(testOperationalStrategy("disabled", "paper"));
assert.equal((await disabledOps.onCandle(testCandle()))[0].status, "rejected");

const sandboxLevelOps = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog()),
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
  new AutomationLevelService(4),
);
sandboxLevelOps.subscribe(testOperationalStrategy("sandbox-level", "sandbox_confirmation"));
assert.equal((await sandboxLevelOps.onCandle(testCandle()))[0].status, "sandbox_confirmation_required");

const levelSixAutomation = new AutomationLevelService(5);
assert.equal(levelSixAutomation.requestTransition({
  targetLevel: 6,
  actorId: "automation-owner",
  acknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
  registeredStrategyCount: 1,
  validatedStrategyCount: 1,
  constraintsConfigured: true,
  monitoringEnabled: true,
  killSwitchAvailable: true,
  sandboxReady: true,
  supervisedPermissionActive: true,
  semiAutonomousApproved: true,
  auditExportReady: true,
  semiAutonomousScope: {
    strategyIds: ["level-six"],
    allowedInstruments: ["EUR/USD"],
    maxRiskPerTradePct: 0.5,
    maxDailyLoss: 100,
    maxOpenPositions: 1,
    maxNotional: 500,
    referenceEquity: 100_000,
    monitoringIntervalSeconds: 10,
    sandboxOnly: true,
  },
}).changed, true);
const levelSixOps = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  new EconomicEventRiskService(new EventLogService(), new ExecutionAuditLog()),
  new ExecutionRiskService(),
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
  levelSixAutomation,
);
levelSixOps.subscribe(testOperationalStrategy("level-six", "paper"));
assert.match(String((await levelSixOps.onCandle(testCandle()))[0].reason), /notional exceeds/);

const killRisk = new ExecutionRiskService();
killRisk.triggerGlobalKillSwitch();
const killedOps = new StrategyOpsService(
  new SignalQualityFilter(),
  new ExecutionRiskPrecheckService(),
  opsRuntime,
  eventRisk,
  killRisk,
  new ExecutionAuditLog(),
  new EventLogService(),
  new MarketDataMetrics(),
);
killedOps.subscribe({
  id: "killed",
  name: "Killed",
  symbols: ["EUR/USD"],
  timeframe: "1m",
  route: "sandbox_confirmation",
  enabled: true,
  units: 1,
  evaluate: () => ({ candidate: true, side: "buy", confidence: 90, thesis: "x", entryReason: "x", expectedMove: "x" }),
  quality: () => ({
    sourceReliability: 90,
    strategyValidationScore: 90,
    timeframeQuality: 90,
    trendAlignment: 90,
    volatilityRegime: 90,
    spreadLiquidityCondition: 90,
    recentFalseSignalRate: 0,
    newsRisk: 0,
    riskRewardRatio: 2,
  }),
  riskContext: () => healthyRiskContext(),
});
assert.equal((await killedOps.onCandle(testCandle()))[0].status, "rejected");

const dashboard = selectStrategyPerformanceDashboard({
  priceFeeds: [fresh],
  strategyOps: ops.listStates(),
  paperRuntime: opsRuntime.listStates(),
  signals: ops.listSignals(),
  openPositions: opsRuntime.listOpen(),
  pnl: { unrealized: 0, realized: closed[0].realizedPnL, wins: 1, losses: 0 },
  postTradeReviews: reviews.list(),
  adaptationSuggestions: adaptations.list(),
  eventBlackouts: eventRisk.list(),
  metrics: metrics.snapshot(),
  safety: { paperAutomationAllowed: true, sandboxConfirmationRequired: true, productionOrderSubmissionEnabled: false },
}, new ExecutionRiskService().snapshot());
assert.deepEqual(Object.keys(dashboard.primary), ["activePaperStrategies", "todaysSignals", "openPositions", "pnlSummary", "riskStatus"]);
assert.equal(dashboard.primary.openPositions.length, 1);
assert.equal(dashboard.safety.productionOrderSubmissionEnabled, false);
assert.equal("priceFeeds" in dashboard.primary, false);

console.log("execution v4 live data and paper strategy ops tests passed");

function testCandle(): Candle {
  return {
    id: "candle-v4",
    symbol: "EUR/USD",
    timeframe: "1m",
    open: 1.1,
    high: 1.101,
    low: 1.0995,
    close: 1.1005,
    volume: 10,
    tickCount: 10,
    startTime: "2026-06-19T12:00:00.000Z",
    endTime: "2026-06-19T12:01:00.000Z",
    provider: "demo",
    closed: true,
  };
}

function testOperationalStrategy(id: string, route: "paper" | "sandbox_confirmation") {
  return {
    id,
    name: id,
    symbols: ["EUR/USD"],
    timeframe: "1m" as const,
    route,
    enabled: true,
    units: 1_000,
    evaluate: () => ({
      candidate: true,
      side: "buy" as const,
      confidence: 85,
      thesis: "Automation level test",
      entryReason: "Rule matched",
      expectedMove: "Continuation",
      stopLoss: 1.099,
      takeProfit: 1.103,
    }),
    quality: () => ({
      sourceReliability: 90,
      strategyValidationScore: 90,
      timeframeQuality: 90,
      trendAlignment: 90,
      volatilityRegime: 90,
      spreadLiquidityCondition: 90,
      recentFalseSignalRate: 5,
      newsRisk: 5,
      riskRewardRatio: 2,
    }),
    riskContext: () => healthyRiskContext(),
  };
}

function healthyRiskContext() {
  return {
    dataAgeSeconds: 1,
    maxDataAgeSeconds: 30,
    spread: 0.0002,
    maxSpread: 0.001,
    volatilityPct: 2,
    maxVolatilityPct: 8,
    dailyLoss: 0,
    maxDailyLoss: 250,
    openPositions: 0,
    maxOpenPositions: 3,
    symbolExposure: 0,
    requestedExposure: 1_100,
    maxSymbolExposure: 100_000,
    correlatedExposure: 0,
    maxCorrelatedExposure: 200_000,
    newsBlackoutActive: false,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 4,
    strategyEnabled: true,
    killSwitchActive: false,
    accountConnected: true,
    accountLastSyncAgeSeconds: 1,
    maxAccountSyncAgeSeconds: 60,
  };
}
