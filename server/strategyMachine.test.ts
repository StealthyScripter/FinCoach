import assert from "node:assert/strict";
import { StrategyMachineCoreService, createEvent, toEventReference, validateEventReferences, InMemoryEventRepository } from "./strategy-machine/core";
import { MarketDataService, normalizeInstrument, type Candle } from "./strategy-machine/market-data";
import { PatternDiscoveryService } from "./strategy-machine/pattern-discovery";
import { HypothesisService } from "./strategy-machine/hypothesis";
import { RuleBuilderService, validateObjective, type RuleSet } from "./strategy-machine/rule-builder";
import { ExperimentManagerService } from "./strategy-machine/experiment-manager";
import { BacktestService } from "./strategy-machine/backtesting";
import { ValidationService } from "./strategy-machine/validation";
import { ForwardTestService } from "./strategy-machine/forward-testing";
import { DemoOnlyPolicyError, DemoOnlyPolicyService } from "./execution/demoOnlyPolicy";
import { TradeJournalService } from "./strategy-machine/journal";
import { StrategyRankingService } from "./strategy-machine/strategy-ranking";
import { MlSupportService } from "./strategy-machine/ml-support";

const repository = new InMemoryEventRepository();
const core = new StrategyMachineCoreService(repository);

const registered = core.registerModule("market-data");
assert.equal(registered.module, "core");
assert.equal(registered.type, "strategy-machine.core.ModuleRegistered");
assert.ok(core.registry().some((module) => module.name === "market-data"));
assert.ok(core.eventCatalog().includes("PatternDetected"));

const snapshot = createEvent({
  type: "MarketSnapshotCreated",
  module: "market-data",
  payload: { instrument: "EUR_USD", bid: 1.1, ask: 1.1002 },
  correlationId: registered.correlationId,
  causationId: registered.id,
  sourceEventRefs: [toEventReference(registered)],
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
});
repository.append(snapshot);

assert.equal(snapshot.contractVersion, 1);
assert.equal(snapshot.schemaVersion, "strategy-machine.v1");
assert.equal(snapshot.causationId, registered.id);
assert.equal(snapshot.sourceEventRefs[0].eventId, registered.id);
assert.equal(validateEventReferences(snapshot.sourceEventRefs), true);
assert.equal(core.validateLineage(snapshot.id), true);

assert.throws(() => {
  (snapshot.payload as Record<string, unknown>).bid = 9;
}, /read only|Cannot assign/);

assert.throws(() => validateEventReferences([toEventReference(snapshot), toEventReference(snapshot)]), /Duplicate/);
assert.throws(() => core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "repository" }), /boundary/);
assert.equal(core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "contract" }), true);

console.log("strategy machine core tests passed");

const marketData = new MarketDataService();
assert.equal(normalizeInstrument("EUR/USD"), "EUR_USD");
assert.equal(marketData.assertSupported("xau/usd").symbol, "XAU_USD");
assert.throws(() => marketData.assertSupported("BTC/USD"), /Unsupported instrument/);

const marketSnapshot = marketData.createSnapshot({
  instrument: "EUR/USD",
  bid: 1.1,
  ask: 1.1002,
  provider: "mock",
  observedAt: new Date("2026-01-01T08:00:00.000Z"),
});
assert.equal(marketSnapshot.type, "MarketSnapshotCreated");
assert.equal(marketSnapshot.payload.mid, 1.1001);

const spread = marketData.detectSpread(marketSnapshot);
assert.equal(spread.type, "SpreadStateDetected");
assert.equal(spread.sourceEventRefs[0].eventId, marketSnapshot.id);

const candles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
  instrument: "EUR_USD",
  timeframe: "15m",
  timestamp: new Date(Date.UTC(2026, 0, 1, 7, index * 15)).toISOString(),
  open: 1.1 + index * 0.0001,
  high: 1.1002 + index * 0.0001,
  low: 1.0999 + index * 0.0001,
  close: 1.1001 + index * 0.0001,
  volume: 100 + index,
}));
const candleSeries = marketData.createCandleSeries(candles);
assert.equal(candleSeries.type, "CandleSeriesCreated");
assert.equal((candleSeries.payload.candles as Candle[]).length, 20);

const session = marketData.detectSession("EUR_USD", new Date("2026-01-01T08:00:00.000Z"));
assert.equal(session.payload.session, "london");

const volatility = marketData.detectVolatility(candles);
assert.equal(volatility.type, "VolatilityStateDetected");
assert.equal(volatility.sourceEventRefs.length, 1);

const economic = marketData.attachEconomicContext("EUR_USD", new Date("2026-01-01T12:30:00.000Z"), [toEventReference(marketSnapshot)]);
assert.equal(economic.payload.blackout, true);
assert.equal(economic.sourceEventRefs[0].eventId, marketSnapshot.id);

console.log("strategy machine market-data tests passed");

const patternDiscovery = new PatternDiscoveryService();
const breakoutCandles: Candle[] = [
  ...Array.from({ length: 9 }, (_, index) => ({
    instrument: "EUR_USD",
    timeframe: "15m" as const,
    timestamp: new Date(Date.UTC(2026, 0, 1, 6, index * 15)).toISOString(),
    open: 1.1 + index * 0.0001,
    high: 1.1005 + index * 0.0001,
    low: 1.0998 + index * 0.0001,
    close: 1.1002 + index * 0.0001,
    volume: 100,
  })),
  {
    instrument: "EUR_USD",
    timeframe: "15m",
    timestamp: "2026-01-01T08:15:00.000Z",
    open: 1.101,
    high: 1.103,
    low: 1.1009,
    close: 1.1028,
    volume: 140,
  },
];
const patternEvents = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles,
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.ok(patternEvents.some((event) => event.type === "PatternDetected" && event.payload.patternType === "breakout"));
assert.ok(patternEvents.every((event) => event.sourceEventRefs.length > 0 || event.type === "PatternClusterCreated"));
const repeated = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles,
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.deepEqual(
  repeated.filter((event) => event.type === "PatternDetected").map((event) => [event.payload.patternType, event.payload.confidence]),
  patternEvents.filter((event) => event.type === "PatternDetected").map((event) => [event.payload.patternType, event.payload.confidence]),
);

const insufficientPatterns = patternDiscovery.detect({
  instrument: "EUR_USD",
  timeframe: "15m",
  candles: breakoutCandles.slice(0, 3),
  sourceEventRefs: [toEventReference(candleSeries)],
});
assert.equal(insufficientPatterns[0].type, "PatternRejected");
assert.equal(insufficientPatterns[0].payload.reason, "insufficient_data");

console.log("strategy machine pattern-discovery tests passed");

const hypothesisService = new HypothesisService();
const hypothesis = hypothesisService.fromPatterns(patternEvents);
assert.equal(hypothesis.type, "HypothesisCreated");
assert.ok(String(hypothesis.payload.statement).includes("EUR_USD"));
assert.ok(Number(hypothesis.payload.requiredSampleSize) >= 30);
assert.ok((hypothesis.payload.regimeTags as string[]).includes("breakout-regime"));
assert.equal(hypothesis.sourceEventRefs.length, patternEvents.filter((event) => event.type === "PatternDetected").length);

const weakHypothesis = hypothesisService.fromPatterns(insufficientPatterns);
assert.equal(weakHypothesis.type, "HypothesisRejected");

console.log("strategy machine hypothesis tests passed");

const ruleBuilder = new RuleBuilderService();
const ruleSetEvent = ruleBuilder.createFromHypothesis(hypothesis);
assert.equal(ruleSetEvent.type, "RuleSetCreated");
const ruleSet = ruleSetEvent.payload as unknown as RuleSet;
assert.equal(validateObjective(ruleSet), true);
assert.equal(ruleSet.version, 1);
assert.equal(ruleSet.instrumentConstraints[0], "EUR_USD");
assert.equal(ruleSet.sourceHypothesisRefs[0].eventId, hypothesis.id);
assert.throws(() => validateObjective({ ...ruleSet, entryCondition: [{ field: "setupQuality", operator: "==", value: "looks strong" }] }), /Subjective/);
const versionedRuleSet = ruleBuilder.version(ruleSet, { takeProfitRule: [{ field: "targetR", operator: ">=", value: 2 }] }, [toEventReference(ruleSetEvent)]);
assert.equal(versionedRuleSet.type, "RuleSetVersioned");
assert.equal((versionedRuleSet.payload as unknown as RuleSet).version, 2);

console.log("strategy machine rule-builder tests passed");

const experimentManager = new ExperimentManagerService();
const experimentCreated = experimentManager.create({
  name: "EUR/USD London breakout research",
  refs: {
    observationRefs: [toEventReference(marketSnapshot)],
    patternRefs: patternEvents.filter((event) => event.type === "PatternDetected").map(toEventReference),
    hypothesisRefs: [toEventReference(hypothesis)],
    ruleSetRefs: [toEventReference(ruleSetEvent)],
  },
  now: new Date("2026-01-01T09:00:00.000Z"),
});
assert.equal(experimentCreated.type, "ExperimentCreated");
const experimentId = String((experimentCreated.payload.experiment as never) ?? experimentCreated.payload.experimentId);
const parsedExperimentId = (experimentCreated.payload as { experimentId: string }).experimentId;
assert.ok(parsedExperimentId || experimentId);
const activeExperimentId = parsedExperimentId || experimentId;
const collecting = experimentManager.transition(activeExperimentId, "collecting_data", [toEventReference(ruleSetEvent)]);
assert.equal(collecting.type, "ExperimentStateChanged");
const backtesting = experimentManager.transition(activeExperimentId, "backtesting");
assert.equal((backtesting.payload as { nextState: string }).nextState, "backtesting");
assert.throws(() => experimentManager.transition(activeExperimentId, "forward_testing"), /Invalid experiment transition/);
assert.equal(experimentManager.get(activeExperimentId).strategyDecisionRefs.length, 1);

console.log("strategy machine experiment-manager tests passed");

const backtestService = new BacktestService();
const backtestCandles: Candle[] = Array.from({ length: 40 }, (_, index) => ({
  instrument: "EUR_USD",
  timeframe: "15m",
  timestamp: new Date(Date.UTC(2026, 0, 2, 7, index * 15)).toISOString(),
  open: 1.1 + index * 0.0003,
  high: 1.1007 + index * 0.0003,
  low: 1.0997 + index * 0.0003,
  close: 1.1004 + index * 0.0003,
  volume: 200,
}));
const backtest = backtestService.run({
  experimentId: activeExperimentId,
  ruleSet,
  candles: backtestCandles,
  spread: 0.0001,
  slippage: 0.00005,
  commissionPerTrade: 0,
  riskPerTrade: 0.0025,
  sourceEventRefs: [toEventReference(ruleSetEvent)],
});
assert.equal(backtest.type, "BacktestCompleted");
assert.ok(Number(backtest.payload.tradeCount) > 0);
assert.ok("profitFactor" in backtest.payload);
assert.ok("maxDrawdown" in backtest.payload);
const insufficientBacktest = backtestService.run({ experimentId: activeExperimentId, ruleSet, candles: backtestCandles.slice(0, 4), spread: 0.0001, slippage: 0, commissionPerTrade: 0, riskPerTrade: 0.0025, sourceEventRefs: [toEventReference(ruleSetEvent)] });
assert.equal(insufficientBacktest.type, "BacktestInsufficientSample");

console.log("strategy machine backtesting tests passed");

const validationService = new ValidationService();
const validation = validationService.validate(backtest);
assert.ok(["ExperimentValidated", "ExperimentReadyForForwardTest", "ExperimentNeedsMoreData", "ExperimentRejected"].includes(validation.type));
assert.ok(Number(validation.payload.evidenceScore) >= 0);
assert.equal(validation.sourceEventRefs[0].eventId, backtest.id);
const needsMoreData = validationService.validate(insufficientBacktest);
assert.equal(needsMoreData.type, "ExperimentNeedsMoreData");

console.log("strategy machine validation tests passed");

const forwardTestService = new ForwardTestService(undefined, new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "true" }));
const forwardTest = forwardTestService.start({
  experimentId: activeExperimentId,
  provider: "paper_provider",
  accountMode: "paper",
  mode: "paper",
  allowedInstruments: ["EUR_USD"],
  riskLimitPct: 0.25,
  refs: [toEventReference(validation)],
});
assert.equal(forwardTest.type, "ForwardTestStarted");
const forwardTestId = String(forwardTest.payload.forwardTestId);
const demoTrade = forwardTestService.openDemoTrade(forwardTestId, { instrument: "EUR_USD", side: "buy", quantity: 1, refs: [toEventReference(forwardTest)], now: new Date("2026-01-03T08:00:00.000Z") });
assert.equal(demoTrade.type, "DemoTradeOpened");
assert.equal(demoTrade.payload.demoOnly, true);
assert.throws(() => forwardTestService.openDemoTrade(forwardTestId, { instrument: "BTC_USD", side: "buy", quantity: 1, refs: [toEventReference(forwardTest)] }), /Instrument not allowed/);
const pausedForwardTest = forwardTestService.pause(forwardTestId, [toEventReference(demoTrade)]);
assert.equal(pausedForwardTest.type, "ForwardTestPaused");
assert.throws(() => new ForwardTestService(undefined, new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "true" })).start({
  experimentId: activeExperimentId,
  provider: "oanda_practice",
  accountMode: "live",
  mode: "practice",
  allowedInstruments: ["EUR_USD"],
  riskLimitPct: 0.25,
  refs: [toEventReference(validation)],
}), DemoOnlyPolicyError);

console.log("strategy machine forward-testing tests passed");

const journalService = new TradeJournalService();
const journalCreated = journalService.create({
  experimentId: activeExperimentId,
  tradeId: String(demoTrade.payload.tradeId),
  instrument: "EUR_USD",
  ruleVersion: ruleSet.version,
  entryReason: "Objective breakout rule triggered after London session filter passed.",
  stopLoss: 1.099,
  takeProfit: 1.103,
  positionSize: 1,
  outcome: "win",
  beforeEntrySnapshotRefs: [toEventReference(marketSnapshot)],
  afterExitSnapshotRefs: [],
  multiTimeframeSnapshotRefs: [toEventReference(candleSeries)],
  screenshotRefs: [{ type: "placeholder", uri: "test://chart-placeholder", capturedAt: "2026-01-03T08:00:00.000Z", redacted: true }],
  sourceEventRefs: [toEventReference(demoTrade)],
});
assert.equal(journalCreated.type, "TradeJournalCreated");
const journalId = String(journalCreated.payload.journalId);
const snapshotAttached = journalService.attachSnapshot(journalId, { after: [toEventReference(spread)] });
assert.equal(snapshotAttached.type, "TradeSnapshotAttached");
const journalReviewEvents = journalService.review(journalId, {
  lessonLearned: "Spread remained acceptable during the breakout.",
  mistakeClassification: null,
  improvementSuggestion: "Retest with tighter spread filter.",
  refs: [toEventReference(snapshotAttached)],
});
assert.ok(journalReviewEvents.some((event) => event.type === "LessonExtracted"));
assert.ok(journalReviewEvents.some((event) => event.type === "RuleImprovementSuggested"));
assert.equal(journalService.search({ experimentId: activeExperimentId, instrument: "EUR_USD", outcome: "win" }).length, 1);
assert.throws(() => journalService.create({ ...(journalCreated.payload as never), entryReason: "" }), /required fields/);

console.log("strategy machine journal tests passed");

const rankingService = new StrategyRankingService();
const ranked = rankingService.rank({
  experimentId: activeExperimentId,
  sampleSize: 80,
  expectancy: 0.35,
  maxDrawdown: 0.7,
  forwardTestScore: 0.8,
  journalQuality: 1,
  regimeSurvival: 0.75,
  symbolSuitability: 0.9,
  sourceEventRefs: [toEventReference(validation), toEventReference(journalReviewEvents[0])],
});
assert.ok(["StrategyRanked", "StrategyPromoted"].includes(ranked.type));
assert.ok(Number(ranked.payload.score) > 0);
const demoted = rankingService.rank({
  experimentId: activeExperimentId,
  sampleSize: 80,
  expectancy: -0.2,
  maxDrawdown: 4,
  forwardTestScore: 0.1,
  journalQuality: 0.5,
  regimeSurvival: 0.2,
  symbolSuitability: 0.5,
  sourceEventRefs: [toEventReference(validation)],
}, "focus");
assert.equal(demoted.type, "StrategyRetired");

console.log("strategy machine strategy-ranking tests passed");

const mlSupport = new MlSupportService();
const regimeClassified = mlSupport.classifyRegime({ instrument: "EUR_USD", atr: 0.004, trendSlope: 0.0002, sourceEventRefs: [toEventReference(volatility)] });
assert.equal(regimeClassified.type, "RegimeClassified");
assert.notEqual(regimeClassified.payload.regime, "next_candle_prediction");
const clustered = mlSupport.clusterPatterns({ patternTypes: ["breakout", "volatility_expansion"], sourceEventRefs: patternEvents.filter((event) => event.type === "PatternDetected").map(toEventReference) });
assert.equal(clustered.type, "PatternClustered");
const tradeQuality = mlSupport.rankTradeQuality({ tradeId: String(demoTrade.payload.tradeId), rMultiple: 1.2, followedRules: true, sourceEventRefs: [toEventReference(journalCreated)] });
assert.equal(tradeQuality.payload.quality, "high");
const priority = mlSupport.prioritizeExperiment({ experimentId: activeExperimentId, evidenceScore: 0.8, journalQuality: 1, sourceEventRefs: [toEventReference(ranked)] });
assert.equal(priority.payload.priority, "high");

console.log("strategy machine ml-support tests passed");
