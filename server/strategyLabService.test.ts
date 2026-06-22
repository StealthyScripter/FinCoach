import assert from "node:assert/strict";
import { PredictionReviewService } from "./predictionReviewService";
import { StrategyAdaptationService } from "./execution/strategyAdaptationService";
import { StrategyEvolutionService, StrategyLabService, MemoryGraphService, RegretAnalysisService, PerformanceDecayService } from "./execution/strategyLabService";
import { StrategyLifecycleMonitorService } from "./execution/strategyLifecycleMonitorService";
import { strategyValidationService } from "./execution/strategyValidation";
import { type StrategyDefinition } from "./execution/domain";
import type { StrategyValidationInput } from "./execution/strategyValidation";
import type { ClosedPaperTrade } from "./execution/paperStrategyRuntime";
import type { PostTradeReview } from "./execution/postTradeReviewService";
import type { JournalReview } from "@shared/schema";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";

const strategies: StrategyDefinition[] = [
  {
    id: "trend-alpha",
    name: "Trend Alpha",
    type: "trend_following",
    entryRule: "Breakout with trend confirmation",
    exitRule: "Trail after expansion",
    stopRule: "ATR-based stop",
    riskPerTradePct: 1,
    maxTradesPerDay: 4,
    allowedInstruments: ["EUR/USD", "USD/JPY"],
    allowedSession: "London / New York",
    invalidationRule: "Trend failure",
    enabled: true,
  },
  {
    id: "breakout-beta",
    name: "Breakout Beta",
    type: "breakout",
    entryRule: "Range break with volume",
    exitRule: "Fixed target",
    stopRule: "Structure stop",
    riskPerTradePct: 1.2,
    maxTradesPerDay: 3,
    allowedInstruments: ["XAU/USD", "EUR/USD"],
    allowedSession: "New York",
    invalidationRule: "Failed breakout",
    enabled: true,
  },
];

const validationInputs: StrategyValidationInput[] = [
  {
    strategyId: "trend-alpha",
    instrument: "EUR/USD",
    backtest: { netReturnPct: 28, sharpe: 1.8, profitFactor: 1.9, maxDrawdownPct: 12, tradeCount: 64 },
    walkForward: { profitableWindowsPct: 72, outOfSampleReturnPct: 11, degradationPct: 14 },
    monteCarlo: { profitableRunsPct: 77, medianEndingReturnPct: 10, riskOfRuinPct: 4 },
    regimePerformance: { trending: 18, ranging: 4, high_volatility: 6, low_volatility: 13 },
    symbolPerformance: { "EUR/USD": 16, "USD/JPY": 12 },
  },
  {
    strategyId: "breakout-beta",
    instrument: "XAU/USD",
    backtest: { netReturnPct: 7, sharpe: 0.8, profitFactor: 1.2, maxDrawdownPct: 28, tradeCount: 31 },
    walkForward: { profitableWindowsPct: 51, outOfSampleReturnPct: -2, degradationPct: 41 },
    monteCarlo: { profitableRunsPct: 54, medianEndingReturnPct: 1, riskOfRuinPct: 17 },
    regimePerformance: { trending: 2, ranging: -6, high_volatility: 8, low_volatility: -4 },
    symbolPerformance: { "XAU/USD": 4, "EUR/USD": -1 },
  },
];

const scorecards = validationInputs.map((input) => strategyValidationService.evaluate(input));

const closedTrades: ClosedPaperTrade[] = [
  ...[18, 16, 14, 12].map((pnl, index) => trade("trend-alpha", "EUR/USD", pnl, index, "buy")),
  ...[-6, -8, -10, -12].map((pnl, index) => trade("trend-alpha", "EUR/USD", pnl, index + 4, "buy")),
  ...[10, -2, 7, -4, 6, -5].map((pnl, index) => trade("breakout-beta", "XAU/USD", pnl, index, index % 2 === 0 ? "buy" : "sell")),
];

const tradeReviews: PostTradeReview[] = closedTrades.map((trade) => ({
  id: `review-${trade.id}`,
  tradeId: trade.id,
  strategyId: trade.strategyId,
  symbol: trade.symbol,
  originalThesis: "Test thesis",
  entryReason: trade.entryReason,
  exitReason: trade.exitReason,
  expectedMove: trade.expectedMove,
  actualMove: trade.actualMove,
  riskTaken: trade.riskTaken,
  result: trade.realizedPnL > 0 ? "win" : trade.realizedPnL < 0 ? "loss" : "breakeven",
  whatWorked: trade.realizedPnL > 0 ? ["Trend alignment held"] : ["Risk limited the trade"],
  whatFailed: trade.realizedPnL < 0 ? ["Exit logic needs review"] : [],
  missedEvidence: trade.strategyId === "trend-alpha" && trade.realizedPnL < 0 ? ["Trend was weakening before entry"] : [],
  updatedLesson: trade.strategyId === "trend-alpha"
    ? "Wait for a stronger trend confirmation."
    : "Tighten breakout confirmation and size control.",
  strategyImprovementNote: trade.strategyId === "trend-alpha"
    ? "Reduce entries during weak trend confirmation."
    : "Demand a cleaner range break and smaller initial size.",
  predictionReviewId: `prediction-${trade.id}`,
  proficiencyGraphUpdates: ["Increase evidence discipline"],
  strategyValidationScoreDelta: trade.realizedPnL > 0 ? 1 : -2,
  adaptationSuggestionIds: [],
  reviewedAt: `2026-06-${String(indexFor(trade.id) + 1).padStart(2, "0")}T12:00:00.000Z`,
}));

const predictionReviewService = new PredictionReviewService();
const prediction1Record = predictionReviewService.record({
  originalThesis: "EUR/USD continuation trade",
  confidence: 88,
  evidenceUsed: ["trend alignment"],
  missingEvidence: ["macro catalyst confirmation"],
  expectedOutcome: "Continuation higher",
  actualOutcome: null,
  timeHorizon: "1d",
  agent: "risk",
  strategyDowngraded: false,
});
const prediction1 = predictionReviewService.review({
  predictionId: prediction1Record.id,
  actualOutcome: "The thesis failed and the move reversed lower.",
  missingEvidence: ["Macro catalyst confirmation was missing."],
  agent: "risk",
}, new Date("2026-06-20T10:00:00.000Z"));
const prediction2Record = predictionReviewService.record({
  originalThesis: "Gold breakout",
  confidence: 61,
  evidenceUsed: ["range compression"],
  missingEvidence: [],
  expectedOutcome: "Break higher",
  actualOutcome: null,
  timeHorizon: "2d",
  agent: "equity",
  strategyDowngraded: false,
});
const prediction2 = predictionReviewService.review({
  predictionId: prediction2Record.id,
  actualOutcome: "The breakout worked and price continued higher.",
  missingEvidence: [],
  agent: "equity",
}, new Date("2026-06-20T11:00:00.000Z"));

const journalReviews: JournalReview[] = [
  {
    id: "jr-1",
    journalEntryId: "je-1",
    qualityScore: 52,
    mistakePatterns: ["Revenge trading", "Weak position sizing discipline"],
    disciplineSignals: ["Acted while frustrated"],
    feedback: ["Needs cooling-off discipline"],
    proficiencyCategory: "trading_psychology",
    proficiencyDelta: -3,
    createdAt: "2026-06-20T12:30:00.000Z",
  },
  {
    id: "jr-2",
    journalEntryId: "je-2",
    qualityScore: 68,
    mistakePatterns: ["Deviated from written plan"],
    disciplineSignals: ["Followed the stop"],
    feedback: ["Need stronger planning"],
    proficiencyCategory: "risk_management",
    proficiencyDelta: 1,
    createdAt: "2026-06-20T13:30:00.000Z",
  },
];

const adaptationService = new StrategyAdaptationService();
const adaptations = [
  ...adaptationService.generate({
    strategyId: "trend-alpha",
    result: "loss",
    exitReason: "stop_loss",
    missedEvidence: ["Trend weakened before entry"],
    riskTaken: 10,
    realizedPnL: -8,
    symbol: "EUR/USD",
  }),
  ...adaptationService.generate({
    strategyId: "breakout-beta",
    result: "loss",
    exitReason: "stop_loss",
    missedEvidence: ["Noise widened the range"],
    riskTaken: 12,
    realizedPnL: -7,
    symbol: "XAU/USD",
  }),
];

const lifecycle = new StrategyLifecycleMonitorService();
const lifecycleReports = [
  lifecycle.analyze("trend-alpha", closedTrades.filter((trade) => trade.strategyId === "trend-alpha"), new Date("2026-06-20T14:00:00.000Z")),
  lifecycle.analyze("breakout-beta", closedTrades.filter((trade) => trade.strategyId === "breakout-beta"), new Date("2026-06-20T14:05:00.000Z")),
];

strategyEvidenceStore.clearForTest();
for (const input of validationInputs) {
  strategyEvidenceStore.recordValidationScorecard(scorecards.find((scorecard) => scorecard.strategyId === input.strategyId)!, input);
}
for (const trade of closedTrades) {
  strategyEvidenceStore.recordClosedTrade({
    strategyId: trade.strategyId,
    symbol: trade.symbol,
    tradeKind: "paper_trade",
    verdict: trade.realizedPnL > 0 ? "healthy" : trade.realizedPnL < 0 ? "watch" : "accept",
    summary: `Closed ${trade.symbol} trade for ${trade.strategyId}`,
    outcome: trade.realizedPnL > 0 ? "win" : trade.realizedPnL < 0 ? "loss" : "breakeven",
    timestamp: trade.closedAt,
    regime: trade.strategyId === "trend-alpha" ? "trending" : "ranging",
    timeframe: trade.strategyId === "trend-alpha" ? "H1" : "H4",
    title: `${trade.strategyId} close`,
    source: "test",
    metadata: {
      realizedPnL: trade.realizedPnL,
      exitReason: trade.exitReason,
      evidenceContext: {
        originalStrategyInputs: { strategyId: trade.strategyId, timeframe: trade.strategyId === "trend-alpha" ? "H1" : "H4" },
        signalFeatures: { confidence: trade.realizedPnL > 0 ? 0.8 : 0.5 },
        marketRegime: trade.strategyId === "trend-alpha" ? "trending" : "ranging",
        volatilityState: trade.strategyId === "trend-alpha" ? "moderate" : "high",
        spreadState: "normal",
        eventBlackoutProximityMinutes: null,
        riskPrecheck: {},
        positionSizingDecision: {},
        lifecycleTimeline: [],
      },
      tradeLifecycle: { timeline: [{ createdAt: trade.openedAt }, { createdAt: trade.closedAt }] },
    },
  });
}
strategyEvidenceStore.recordSandboxTrade({
  strategyId: "breakout-beta",
  symbol: "XAU/USD",
  summary: "Sandbox fill for breakout-beta",
  outcome: "filled",
  timestamp: "2026-06-20T14:30:00.000Z",
  regime: "sandbox",
  timeframe: "M15",
  metadata: { originalStrategyInputs: { strategyId: "breakout-beta" } },
});
strategyEvidenceStore.recordRejectedSignal({
  strategyId: "trend-alpha",
  symbol: "EUR/USD",
  reason: "Trend confirmation was not strong enough",
  signalId: "rejected-1",
  timestamp: "2026-06-20T15:00:00.000Z",
  regime: "trending",
  timeframe: "H1",
});

const lab = new StrategyLabService();
const snapshot = lab.build({
  strategies,
  validationInputs,
  scorecards,
  closedTrades,
  postTradeReviews: tradeReviews,
  predictionReviews: [prediction1, prediction2],
  journalReviews,
  adaptations,
  lifecycleReports,
});

assert.equal(snapshot.topStrategies.length, 2);
assert.equal(snapshot.weakStrategies[0].strategyId, "breakout-beta");
assert.ok(snapshot.retirementCandidates.length >= 1);
assert.ok(snapshot.latestLessons.length <= 5);
assert.ok(snapshot.recurringMistakes.items.some((item) => item.pattern === "overconfidence"));
assert.ok(snapshot.recurringMistakes.items.some((item) => item.pattern === "revenge_trading"));
assert.ok(snapshot.confidenceCalibration.totalReviews === 2);
assert.ok(snapshot.confidenceCalibration.calibrationDrift > 0);
assert.ok(snapshot.strategyEvolution.some((item) => item.strategyId === "trend-alpha"));
assert.ok(snapshot.strategyEvolution.find((item) => item.strategyId === "breakout-beta")?.verdict !== "healthy");
assert.ok(snapshot.regretAnalysis.items.some((item) => item.pattern === "bad_exits"));
assert.ok(snapshot.counterfactualAnalysis.items.length === closedTrades.length);
assert.ok(snapshot.counterfactualAnalysis.items[0].scenarios.length === 6);
assert.ok(snapshot.performanceDecay.items.some((item) => item.strategyId === "breakout-beta"));
assert.ok(snapshot.crossStrategyComparison.items.length === 5);
assert.ok(snapshot.learningPriorities.items.length >= 3);
assert.equal(snapshot.evidenceDepth.length, 2);
assert.ok(snapshot.evidenceDepth.some((item) => !item.minimumEvidenceThreshold));
assert.equal(snapshot.evidenceDepth.find((item) => item.strategyId === "trend-alpha")?.minimumEvidenceThreshold, false);
assert.ok(snapshot.closedTradeHistory.some((entry) => entry.strategyId === "trend-alpha"));
assert.ok(snapshot.closedTradeHistory.some((entry) => entry.trades.some((trade) => trade.originalStrategyInputs !== undefined)));
assert.ok(snapshot.rejectedSignalLearning.some((entry) => entry.strategyId === "trend-alpha"));
assert.ok(snapshot.verdictExplanations.length === 2);
assert.ok(snapshot.verdictExplanations[0].whyRankedThisWay.length > 0);
assert.ok(snapshot.memoryGraph.nodes.some((node) => node.kind === "lesson"));
assert.ok(snapshot.memoryGraph.edges.some((edge) => edge.type === "lesson_to_mistake"));
assert.ok(snapshot.memoryGraph.traversal.visitedNodeIds.length > 0);
strategyEvidenceStore.clearForTest();

const graph = new MemoryGraphService();
graph.recordChain({
  lesson: "Wait for confirmation",
  mistake: "FOMO entry",
  strategyId: "trend-alpha",
  strategyName: "Trend Alpha",
  asset: "EUR/USD",
  outcome: "loss",
  reviewId: "review-1",
  updatedRule: "Require a second confirmation",
  reminder: "Check the plan before entry",
  futureTrade: "trend-alpha-followup",
  confidence: 82,
  timestamp: "2026-06-20T10:00:00.000Z",
});
const graphSnapshot = graph.snapshot("lesson-wait-for-confirmation");
assert.equal(graphSnapshot.traversal.visitedNodeIds[0], "lesson-wait-for-confirmation");
assert.ok(graphSnapshot.influenceScores.length > 0);

const regret = new RegretAnalysisService().analyze({
  closedTrades,
  postTradeReviews: tradeReviews,
  adaptations,
});
assert.ok(regret.items.some((item) => item.pattern === "unnecessary_losses"));

const decay = new PerformanceDecayService().analyze({ strategies, closedTrades });
assert.ok(decay.items.some((item) => item.verdict === "pause" || item.verdict === "retire"));

console.log("strategyLabService tests passed");

function trade(strategyId: string, symbol: string, realizedPnL: number, index: number, side: "buy" | "sell"): ClosedPaperTrade {
  const entryPrice = 100;
  const exitPrice = 100 + realizedPnL;
  return {
    id: `${strategyId}-${index}`,
    strategyId,
    symbol,
    side,
    units: 1,
    entryPrice,
    currentPrice: exitPrice,
    stopLoss: side === "buy" ? 92 : 108,
    takeProfit: side === "buy" ? 116 : 84,
    trailingStopDistance: null,
    highestPrice: Math.max(entryPrice, exitPrice) + (realizedPnL > 0 ? 4 : 1),
    lowestPrice: Math.min(entryPrice, exitPrice) - (realizedPnL < 0 ? 4 : 1),
    unrealizedPnL: 0,
    openedAt: `2026-06-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    lifecycleId: `lifecycle-${strategyId}-${index}`,
    thesis: "Test thesis",
    entryReason: "Test entry",
    expectedMove: realizedPnL > 0 ? "Higher" : "Lower",
    riskTaken: Math.max(4, Math.abs(realizedPnL) + 2),
    exitPrice,
    exitReason: realizedPnL >= 0 ? "take_profit" : index % 2 === 0 ? "stop_loss" : "manual",
    realizedPnL,
    actualMove: realizedPnL,
    closedAt: `2026-06-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`,
  };
}

function indexFor(id: string) {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}
