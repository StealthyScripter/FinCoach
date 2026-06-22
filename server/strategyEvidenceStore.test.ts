import assert from "node:assert/strict";
import { strategyEvidenceStore, sampleDepthService } from "./execution/strategyEvidenceStore";
import type { StrategyValidationInput, StrategyValidationScorecard } from "./execution/strategyValidation";

strategyEvidenceStore.clearForTest();

const validationInput: StrategyValidationInput = {
  strategyId: "evidence-alpha",
  instrument: "EUR/USD",
  backtest: { netReturnPct: 24, sharpe: 1.6, profitFactor: 1.8, maxDrawdownPct: 11, tradeCount: 42 },
  walkForward: { profitableWindowsPct: 71, outOfSampleReturnPct: 8, degradationPct: 12 },
  monteCarlo: { profitableRunsPct: 75, medianEndingReturnPct: 7, riskOfRuinPct: 5 },
  regimePerformance: { trending: 14, ranging: 6, high_volatility: 4, low_volatility: 11 },
  symbolPerformance: { "EUR/USD": 15 },
};

const scorecard: StrategyValidationScorecard = {
  strategyId: "evidence-alpha",
  instrument: "EUR/USD",
  backtestScore: 82,
  walkForwardScore: 76,
  monteCarloRobustnessScore: 78,
  drawdownScore: 84,
  riskOfRuinScore: 80,
  tradeCountSufficiency: 42,
  overfittingWarning: false,
  regimeSensitivity: "moderate",
  symbolSuitability: 72,
  overallScore: 79,
  verdict: "watchlist",
  reasons: ["Strong enough for review"],
  evaluatedAt: "2026-06-21T10:00:00.000Z",
  liveExecutionAuthorized: false,
};

strategyEvidenceStore.recordValidationScorecard(scorecard, validationInput);
strategyEvidenceStore.recordRegimeLabel("evidence-alpha", {
  regime: "trending",
  source: "manual-review",
  summary: "Trending conditions dominated the sample",
  symbol: "EUR/USD",
  verdict: "healthy",
});
strategyEvidenceStore.recordSymbolSuitability("evidence-alpha", {
  symbol: "EUR/USD",
  verdict: "healthy",
  summary: "EUR/USD has the strongest fit",
  source: "validation",
});
strategyEvidenceStore.recordUserOverride("evidence-alpha", {
  verdict: "watch",
  summary: "User requested closer monitoring",
  source: "ui",
});
strategyEvidenceStore.recordRejectedSignal({
  strategyId: "evidence-alpha",
  symbol: "EUR/USD",
  reason: "Signal quality too weak",
  signalId: "signal-1",
  timestamp: "2026-06-21T09:00:00.000Z",
  regime: "trending",
  timeframe: "H1",
  metadata: { rule: "trend filter" },
});
strategyEvidenceStore.recordClosedTrade({
  strategyId: "evidence-alpha",
  symbol: "EUR/USD",
  tradeKind: "paper_trade",
  verdict: "healthy",
  summary: "Winning paper trade",
  outcome: "win",
  timestamp: "2026-06-21T09:30:00.000Z",
  regime: "trending",
  timeframe: "H1",
  title: "paper close",
  source: "test",
  metadata: { realizedPnL: 12, exitReason: "take_profit", tradeLifecycle: { timeline: [{ createdAt: "2026-06-21T09:00:00.000Z" }, { createdAt: "2026-06-21T09:30:00.000Z" }] } },
});
strategyEvidenceStore.recordSandboxTrade({
  strategyId: "evidence-alpha",
  symbol: "EUR/USD",
  summary: "Sandbox order filled",
  outcome: "filled",
  timestamp: "2026-06-21T10:15:00.000Z",
  regime: "sandbox",
  timeframe: "M15",
  metadata: { confidence: 0.8 },
});
strategyEvidenceStore.recordPostTradeReview({
  strategyId: "evidence-alpha",
  symbol: "EUR/USD",
  summary: "Win review",
  outcome: "win",
  verdict: "healthy",
  timestamp: "2026-06-21T09:35:00.000Z",
  regime: "trending",
  metadata: { tradeId: "trade-1" },
});

strategyEvidenceStore.recordClosedTrade({
  strategyId: "evidence-alpha",
  symbol: "GBP/USD",
  tradeKind: "paper_trade",
  verdict: "watch",
  summary: "Losing paper trade",
  outcome: "loss",
  timestamp: "2026-06-21T08:00:00.000Z",
  regime: "ranging",
  timeframe: "H4",
  title: "paper close 2",
  source: "test",
  metadata: { realizedPnL: -9, exitReason: "stop_loss", tradeLifecycle: { timeline: [{ createdAt: "2026-06-21T07:00:00.000Z" }, { createdAt: "2026-06-21T08:00:00.000Z" }] } },
});
strategyEvidenceStore.recordClosedTrade({
  strategyId: "evidence-alpha",
  symbol: "XAU/USD",
  tradeKind: "paper_trade",
  verdict: "healthy",
  summary: "Gold paper trade",
  outcome: "win",
  timestamp: "2026-06-21T06:30:00.000Z",
  regime: "high_volatility",
  timeframe: "M15",
  title: "paper close 3",
  source: "test",
  metadata: { realizedPnL: 7, exitReason: "take_profit", tradeLifecycle: { timeline: [{ createdAt: "2026-06-21T05:30:00.000Z" }, { createdAt: "2026-06-21T06:30:00.000Z" }] } },
});
strategyEvidenceStore.recordSandboxTrade({
  strategyId: "evidence-alpha",
  symbol: "WTI",
  summary: "Sandbox oil trade",
  outcome: "filled",
  timestamp: "2026-06-21T07:30:00.000Z",
  regime: "sandbox",
  timeframe: "M30",
  metadata: { originalStrategyInputs: { strategyId: "evidence-alpha", timeframe: "M30" } },
});

const byStrategy = strategyEvidenceStore.query({ strategyId: "evidence-alpha" });
assert.ok(byStrategy.length >= 7);
assert.ok(strategyEvidenceStore.query({ verdict: "healthy" }).length >= 3);
assert.equal(strategyEvidenceStore.query({ symbol: "EUR/USD" }).every((record) => record.symbol === "EUR/USD"), true);
assert.equal(strategyEvidenceStore.query({ kind: "rejected_signal" }).length, 1);
assert.equal(strategyEvidenceStore.query({ regime: "trending" }).length >= 2, true);

const rejected = strategyEvidenceStore.analyzeRejectedSignals("evidence-alpha");
assert.equal(rejected.length, 1);
assert.equal(rejected[0].correct, false);
assert.equal(rejected[0].missedOpportunity, true);

const sampleDepth = sampleDepthService.analyze(strategyEvidenceStore.snapshot().records, "evidence-alpha");
assert.equal(sampleDepth.verdict, "robust");
assert.ok(sampleDepth.totalTrades >= 2);
assert.ok(sampleDepth.symbolsTested.includes("EUR/USD"));
assert.ok(sampleDepth.regimesTested.includes("trending"));
assert.ok(sampleDepth.timeframesTested.includes("H1"));
assert.equal(sampleDepth.minimumEvidenceThreshold, true);

const exportLines = strategyEvidenceStore.exportJsonLines();
assert.match(exportLines, /evidence-alpha/);
const replay = await strategyEvidenceStore.replay(20);
assert.ok(replay.length >= byStrategy.length);

strategyEvidenceStore.clearForTest();

console.log("strategyEvidenceStore tests passed");
