import assert from "node:assert/strict";
import { BacktestingV2Engine } from "./v2/backtesting";
import { CourtroomV2Service } from "./v2/courtroom";
import { ExperimentsV2Service } from "./v2/experiments";
import { HypothesisV2Service } from "./v2/hypothesis";
import { MarketMemoryV2Service } from "./v2/market-memory";
import type { NormalizedCandle } from "./v2/market-data";
import { RankingV2Service } from "./v2/ranking";
import { RulesV2Compiler } from "./v2/rules";

const correlationId = "00000000-0000-4000-8000-000000000100";
const observationId = "obs-breakout-1";
const traderAnalysisId = "ta-day-1";
const hypothesis = new HypothesisV2Service().generate({
  statement: "London breakouts after compressed Asia range outperform the baseline.",
  targetPopulation: { symbols: ["EUR_USD"], assetClasses: ["forex"], timeframes: ["1h"], sessions: ["london"], regimes: ["trend"] },
  conditions: [{ field: "asian_range_percentile", operator: "<", value: 25 }, { field: "atr_slope", operator: ">", value: 0 }],
  expectedOutcome: { metric: "expectancy", operator: ">", value: 0.1, horizon: "london_session" },
  baseline: { baselineId: "unconditional-london-breakout", description: "Unconditional London breakout", metric: "expectancy", value: 0 },
  invalidationCriteria: [{ field: "close", operator: "<", value: "asian_high" }],
  minimumSampleSize: 3, minimumIndependentOccurrences: 3, mechanism: "volatility expansion after compression",
  evidenceEventIds: [observationId, traderAnalysisId, "obs-breakout-2"], contradictoryEvidenceEventIds: ["contra-1"], sourceObservationIds: [observationId, "obs-breakout-2", "obs-breakout-3"], sourceTraderAnalysisIds: [traderAnalysisId], correlationId, causationId: null,
}).hypothesis!;
assert.ok(hypothesis.sourceObservationIds.includes(observationId));
assert.ok(hypothesis.sourceTraderAnalysisIds.includes(traderAnalysisId));

const strategy = new RulesV2Compiler().compile({
  hypothesisId: hypothesis.hypothesisId, name: "London compression breakout", assetClasses: ["forex"], symbols: ["EUR_USD"], timeframes: ["1h"],
  entryConditions: [{ field: "asian_range_percentile", operator: "<", value: 25 }, { field: "atr_slope", operator: ">", value: 0 }],
  filters: [], sidePolicy: { candidateSide: "buy" }, stopLoss: { type: "atr_multiple", value: 1 }, takeProfit: { type: "atr_multiple", value: 1.5 },
  timeExit: { type: "time", value: "london_close" }, invalidationRules: [{ field: "close", operator: "<", value: "asian_high" }],
  positionSizing: { type: "fixed_fractional", riskFraction: 0.01 }, costModel: { costModelId: "fx-realistic", version: "1" },
  sessionRestrictions: [{ field: "session", operator: "==", value: "london" }], eventRestrictions: [], supportedRegimes: ["trend"], requiredFeatureDefinitions: [{ featureId: "atr_slope", version: "1" }],
  correlationId, causationId: null,
}).strategy!;
assert.equal(strategy.hypothesisId, hypothesis.hypothesisId);

const experiment = new ExperimentsV2Service().create({
  hypothesisId: hypothesis.hypothesisId, strategyId: strategy.strategyId, strategyVersion: strategy.strategyVersion, experimentType: "baseline_backtest",
  datasetSpecification: { symbols: ["EUR_USD"], timeframes: ["1h"], start: "2020-01-01", end: "2021-01-01" },
  parameterSpecification: { grid: { atr: [1] } }, holdoutPolicy: { trainEnd: "2020-06-01", validationEnd: "2021-01-01", testStart: "2022-01-01", finalHoldoutLocked: true },
  randomSeed: "milestone-seed", resourceBudget: { maxCandles: 1000, maxRuntimeMs: 10000 }, priority: 1, maxAttempts: 1, correlationId, causationId: null,
}).experiment;
assert.equal(experiment.strategyVersion, strategy.strategyVersion);

const candles: NormalizedCandle[] = Array.from({ length: 24 }, (_, i) => {
  const close = 1.1 + i * 0.002;
  return { symbol: "EUR_USD", timeframe: "1h", timestamp: new Date(Date.UTC(2020, 0, 1, i)).toISOString(), open: close - 0.001, high: close + 0.002, low: close - 0.002, close, spread: 0.0001, volume: 1000, tickVolume: 100, complete: true, source: { provider: "fixture", providerSymbol: "EUR_USD", adapterVersion: "test" }, corporateAction: null };
});
const engine = new BacktestingV2Engine();
const backtest = engine.run({ experimentId: experiment.experimentId, strategy, candles, randomSeed: "milestone-seed", lineageEventIds: [experiment.experimentId, strategy.strategyId], correlationId, causationId: null, spread: 0.0001, commissionPerTrade: 0.00001, slippage: 0.00001 }).result;
const expensive = engine.run({ experimentId: `${experiment.experimentId}-cost`, strategy, candles, randomSeed: "milestone-seed", lineageEventIds: [experiment.experimentId, strategy.strategyId], correlationId, causationId: null, spread: 0.01, commissionPerTrade: 0.01, slippage: 0.01 }).result;
assert.equal(backtest.experimentId, experiment.experimentId);
assert.ok(expensive.aggregateMetrics.expectancy < backtest.aggregateMetrics.expectancy);

const court = new CourtroomV2Service().open({
  strategyId: strategy.strategyId, strategyVersion: strategy.strategyVersion, hypothesisId: hypothesis.hypothesisId, experimentIds: [experiment.experimentId], backtests: [backtest],
  defenseExhibits: [{ exhibitId: "def", sourceEventId: backtest.backtestId, kind: "defense", summary: "positive OOS expectancy" }],
  prosecutionExhibits: [{ exhibitId: "pros", sourceEventId: expensive.backtestId, kind: "prosecution", summary: "cost sensitivity reviewed" }],
  riskExhibits: [{ exhibitId: "risk", sourceEventId: backtest.backtestId, kind: "risk", summary: "drawdown reviewed" }],
  correlationId, causationId: null,
}).courtCase;
const rejectedCourt = new CourtroomV2Service().open({ ...court, experimentIds: [experiment.experimentId], backtests: [{ ...backtest, aggregateMetrics: { ...backtest.aggregateMetrics, tradeCount: 1 } }], defenseExhibits: [{ exhibitId: "d2", sourceEventId: backtest.backtestId, kind: "defense", summary: "weak" }], prosecutionExhibits: [{ exhibitId: "p2", sourceEventId: backtest.backtestId, kind: "prosecution", summary: "weak sample" }], riskExhibits: [{ exhibitId: "r2", sourceEventId: backtest.backtestId, kind: "risk", summary: "weak sample" }] }).courtCase;
assert.equal(rejectedCourt.verdict, "reject");

const memory = new MarketMemoryV2Service();
const q = memory.createVector({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: "2020-01-01T12:00:00.000Z", features: { trend: 1, volatility: 0.2 }, sourceEventIds: [court.caseId], correlationId, causationId: null }).vector!;
memory.createVector({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: "2019-01-01T12:00:00.000Z", features: { trend: 1, volatility: 0.21 }, sourceEventIds: ["hist-1"], correlationId, causationId: null });
const similarity = memory.search({ queryStateId: q.stateId, minNeighbors: 1, correlationId, causationId: null }).result;
assert.equal(similarity.neighbors.length, 1);

const ranking = new RankingV2Service().rank({ candidates: [
  { strategyId: strategy.strategyId, strategyVersion: strategy.strategyVersion, hypothesisId: hypothesis.hypothesisId, courtCaseId: court.caseId, courtVerdict: court.verdict, metrics: { oosExpectancy: 0.6, confidenceInterval: 0.1, sampleDepth: 60, walkForwardStability: 0.8, parameterRobustness: 0.8, costResilience: 0.8, maxDrawdown: 0.08, tailRisk: 0.08, regimeDiversity: 0.7, operationalComplexity: 0.2, turnover: 0.2, exposure: 0.3 }, similarityConfidence: similarity.confidence, evidenceFreshness: 1, lineageEventIds: [court.caseId, q.stateId], assetClass: "forex", timeframe: "1h", horizon: "day", correlationCluster: "breakout", rawReturn: 0.9 },
  { strategyId: "court-rejected", strategyVersion: 1, hypothesisId: hypothesis.hypothesisId, courtCaseId: rejectedCourt.caseId, courtVerdict: "reject", metrics: { oosExpectancy: 10, confidenceInterval: 0.1, sampleDepth: 2, walkForwardStability: 0.1, parameterRobustness: 0.1, costResilience: 0.1, maxDrawdown: 0.9, tailRisk: 0.9, regimeDiversity: 0.1, operationalComplexity: 0.9, turnover: 0.9, exposure: 1 }, similarityConfidence: 1, evidenceFreshness: 1, lineageEventIds: [rejectedCourt.caseId], assetClass: "forex", timeframe: "1h", horizon: "day", correlationCluster: "breakout", rawReturn: 10 },
], maxFocusedCount: 1, correlationId, causationId: null }).decision;
assert.equal(ranking.focusedPortfolio.strategies[0].strategyId, strategy.strategyId);
assert.equal(ranking.retirements[0].strategyId, "court-rejected");
assert.equal("placeOrder" in engine || "signalPublisher" in new RankingV2Service(), false);
console.log("v2 research-validation milestone tests passed");
