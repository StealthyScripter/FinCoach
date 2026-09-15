import assert from "node:assert/strict";
import { AutonomousPracticePromotionAuthority } from "./v2/execution/promotionAuthority";
import { InMemoryDemoPromotionRepository } from "./v2/execution/promotionRepository";
import { createAutonomousPracticePromotions } from "./v2/runtime/composition";
import type { StrategyDefinition } from "./v2/rules";
import type { StrategyLifecycleDecision } from "./v2/strategy-lifecycle";
import type { ExternalEvaluation } from "./v2/external-evaluation";
import type { ForwardTestRecord } from "./v2/forward-testing";

const now = new Date("2026-10-01T12:00:00.000Z");
const env = {
  FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_PAPER_EXECUTION_ENABLED: "false",
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: "true",
  OANDA_ENV: "practice",
  OANDA_BASE_URL: "https://api-fxpractice.oanda.com/v3",
};
const config = { minBacktestTrades: 100, minBacktestDays: 90, minForwardTestTrades: 30, minForwardTestDays: 14, minProfitFactor: 1.2, maxDrawdownPct: 10, minSharpeRatio: 0.5 } as const;
const forwardTestArchivedId = "forward-archived";

const strategy = {
  strategyId: "strategy-qualifying",
  strategyVersion: 1,
  schemaVersion: "fincoach.v2.strategy.1",
  hypothesisId: "hypothesis-1",
  name: "Qualifying practice strategy",
  assetClasses: ["fx"], symbols: ["EUR/USD"], timeframes: ["1m"], entryConditions: [], filters: [],
  sidePolicy: { candidateSide: "buy" }, stopLoss: { type: "atr_multiple", value: 1 }, takeProfit: { type: "atr_multiple", value: 2 }, timeExit: null,
  invalidationRules: [], positionSizing: { type: "fixed_fractional", riskFraction: 0.001 }, costModel: { costModelId: "fx", version: "1" }, requiredFeatureDefinitions: [],
  sessionRestrictions: [], eventRestrictions: [], supportedRegimes: ["trend"], complexityScore: 1, fingerprint: "fingerprint-1", createdAt: "2026-01-01T00:00:00.000Z", correlationId: "correlation-1", causationId: null,
  researchOnly: true,
  lineageEventIds: ["hypothesis-1", "strategy-event-1"],
} as unknown as StrategyDefinition & { researchOnly: boolean; lineageEventIds: string[] };

const lifecycle = (toState: StrategyLifecycleDecision["toState"], decisionId = "lifecycle-1"): StrategyLifecycleDecision => ({
  decisionId, schemaVersion: "fincoach.v2.strategy-lifecycle.1", strategyId: strategy.strategyId, fromState: "forward-test", toState,
  reason: `test ${toState}`, metrics: { expectancy: 0.5, drawdown: 2, calibration: 0.8, evidenceAgeDays: 1, regimeMismatch: 0, externalDisagreement: 0, edgeDecay: 0 },
  createdAt: decisionId === "lifecycle-1" ? "2026-09-30T12:00:00.000Z" : "2026-10-01T11:00:00.000Z", lineageEventIds: ["forward-event-1", decisionId], correlationId: "correlation-1", causationId: "causation-1",
});

const forwardTest = {
  forwardTestId: "forward-1", schemaVersion: "fincoach.v2.forward-test.1", strategyId: strategy.strategyId, strategyVersion: 1, courtCaseId: "court-1", rankingId: "ranking-1", status: "completed",
  demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: "2026-09-01T12:00:00.000Z" },
  snapshot: { snapshotId: "snapshot-1", symbol: "EUR/USD", timestamp: "2026-09-01T12:00:00.000Z", bid: 1.1, ask: 1.1002, spread: 0.0002, fresh: true, contextEventId: "context-1", lineageEventIds: ["snapshot-1"] },
  ruleEvaluation: {}, reason: "completed", counterargument: "", expectedR: 1, risk: 0.001, createdAt: "2026-09-01T12:00:00.000Z", lineageEventIds: ["forward-event-1"], correlationId: "correlation-1", causationId: "causation-1", supersedesId: forwardTestArchivedId,
} as ForwardTestRecord;

const evaluations: ExternalEvaluation[] = Array.from({ length: 30 }, (_, index) => ({
  evaluationId: `evaluation-${index + 1}`, schemaVersion: "fincoach.v2.external-evaluation.1", signalId: `signal-${index + 1}`, strategyId: strategy.strategyId, forwardTestId: forwardTestArchivedId,
  evaluationSource: "research_candles", evaluatorVersion: "test", entryReached: true, slReached: index >= 20, tpReached: index < 20, outcome: index < 20 ? "tp" : "sl", r: index < 20 ? 1 : -0.5, profitLoss: index < 20 ? 1 : -0.5, mfe: 1, mae: 0.5, holdingDurationMinutes: 30,
  dataSource: "provider", evaluatedAt: new Date(Date.parse("2026-09-01T12:00:00.000Z") + index * 12 * 60 * 60_000).toISOString(), evidenceHash: `hash-${index + 1}`, notes: "test evidence", lineageEventIds: [strategy.strategyId, forwardTestArchivedId, `signal-${index + 1}`], correlationId: "correlation-1", causationId: "causation-1",
}));

const evidence = {
  strategy,
  courtCases: [{ caseId: "court-1", schemaVersion: "fincoach.v2.court.1", strategyId: strategy.strategyId, strategyVersion: 1, hypothesisId: strategy.hypothesisId, experimentIds: ["experiment-1"], backtestIds: ["backtest-1"], defenseExhibits: [{ exhibitId: "d", sourceEventId: "backtest-event", kind: "defense", summary: "test" }], prosecutionExhibits: [], riskExhibits: [{ exhibitId: "r", sourceEventId: "backtest-event", kind: "risk", summary: "test" }], policyVersion: "courtroom.policy.v1", verdict: "approve_for_replay", verdictReasons: [], remediation: [], evidenceScore: 0.9, createdAt: "2026-08-01T00:00:00.000Z", correlationId: "correlation-1", causationId: "causation-1", lineageEventIds: ["backtest-event"] }],
  rankings: [{ rankingId: "ranking-1", policyVersion: "ranking.v1", generatedAt: "2026-09-01T12:00:00.000Z", candidates: [{ strategyId: strategy.strategyId, strategyVersion: 1, hypothesisId: strategy.hypothesisId, courtCaseId: "court-1", courtVerdict: "approve_for_replay", metrics: { oosExpectancy: 0.5, confidenceInterval: 0.1, sampleDepth: 100, walkForwardStability: 0.8, parameterRobustness: 0.8, costResilience: 0.8, maxDrawdown: 4, tailRisk: 0.1, regimeDiversity: 0.8, operationalComplexity: 1, turnover: 1, exposure: 0.2 }, similarityConfidence: 0.8, evidenceFreshness: 1, lineageEventIds: ["backtest-event"], assetClass: "fx", timeframe: "1m", horizon: "short", correlationCluster: "cluster-1", rawReturn: 10, score: 5, rank: 1, status: "candidate", reasons: [] }], focusedPortfolio: { maxFocusedCount: 1, strategies: [], constraints: {} }, demotions: [], retirements: [], evidenceGaps: [], correlationMatrixReference: "matrix-1", correlationId: "correlation-1", causationId: "causation-1", schemaVersion: "fincoach.v2.ranking.1", lineageEventIds: ["ranking-event"] }],
  experiments: [{ experimentId: "experiment-1", schemaVersion: "fincoach.v2.experiment.1", hypothesisId: strategy.hypothesisId, strategyId: strategy.strategyId, strategyVersion: 1, experimentType: "baseline_backtest", datasetSpecification: { symbols: ["EUR/USD"], timeframes: ["1m"], start: "2026-01-01T00:00:00.000Z", end: "2026-04-15T00:00:00.000Z" }, parameterSpecification: {}, holdoutPolicy: { trainEnd: "2026-03-01T00:00:00.000Z", validationEnd: "2026-04-01T00:00:00.000Z", testStart: "2026-04-01T00:00:00.000Z", finalHoldoutLocked: true }, randomSeed: "seed", resourceBudget: { maxCandles: 1000, maxRuntimeMs: 1000 }, priority: 1, status: "completed", attempt: 1, maxAttempts: 1, fingerprint: "experiment-fingerprint", createdAt: "2026-01-01T00:00:00.000Z", correlationId: "correlation-1", causationId: "causation-1", lineageEventIds: [strategy.hypothesisId, strategy.strategyId] }],
  backtests: [{ backtestId: "backtest-1", experimentId: "experiment-1", strategyId: strategy.strategyId, strategyVersion: 1, datasetFingerprint: "dataset", engineVersion: "engine", costModelVersion: "cost", fillModelVersion: "fill", randomSeed: "seed", partitions: [], aggregateMetrics: { netProfit: 20, grossProfit: 30, grossLoss: 10, profitFactor: 3, expectancy: 0.2, averageR: 0.2, medianR: 0.2, winRate: 0.6, lossRate: 0.4, maxDrawdown: 4, tradeCount: 100, sampleDepth: 100, costSensitivity: 0.1, stability: 0.8 }, trades: Array.from({ length: 100 }, (_, index) => ({ tradeId: `backtest-trade-${index}`, entryAt: "2026-01-01T00:00:00.000Z", exitAt: "2026-01-02T00:00:00.000Z", side: "buy", entry: 1.1, exit: 1.101, r: 0.2, cost: 0, mfe: 1, mae: 0.5 })), warnings: [], lineageEventIds: ["experiment-1"], status: "completed", createdAt: "2026-04-15T00:00:00.000Z", correlationId: "correlation-1", causationId: "experiment-1" }],
  forwardTests: [forwardTest, { ...forwardTest, forwardTestId: forwardTestArchivedId, status: "monitoring", supersedesId: null }], evaluations, lifecycleDecisions: [lifecycle("candidate")], existingPromotion: null, config, env, now, correlationId: "correlation-1", causationId: "causation-1",
};

const authority = new AutonomousPracticePromotionAuthority();
const qualifying = authority.evaluate(evidence);
assert.equal(qualifying.decision, "PROMOTE");
assert.equal(qualifying.promotion?.environment, "practice");
assert.equal(qualifying.promotion?.authority, "fincoach.autonomous-practice-promotion-authority");
assert.equal(strategy.researchOnly, true, "promotion must not mutate researchOnly");

const promotions = new InMemoryDemoPromotionRepository();
assert.ok(qualifying.promotion);
promotions.save(qualifying.promotion!);
const repeated = authority.evaluate({ ...evidence, existingPromotion: promotions.getForStrategy(strategy.strategyId) });
assert.equal(repeated.decision, "HOLD");
assert.equal(repeated.reason, "practice_promotion_already_active");
assert.equal(promotions.history(strategy.strategyId).length, 1);

const nonQualifying = authority.evaluate({ ...evidence, evaluations: evaluations.slice(0, 2) });
assert.equal(nonQualifying.decision, "HOLD");
assert.ok(nonQualifying.unmetRequirements.includes("forward_test_observation_count"));
assert.equal(nonQualifying.promotion, null);

const invalidLineage = authority.evaluate({ ...evidence, strategy: { ...strategy, lineageEventIds: [] } });
assert.ok(invalidLineage.unmetRequirements.includes("strategy_lineage"));
const rejectedCourt = authority.evaluate({ ...evidence, courtCases: [{ ...evidence.courtCases[0], verdict: "reject" }] });
assert.ok(rejectedCourt.unmetRequirements.includes("qualifying_court_verdict"));
const retired = authority.evaluate({ ...evidence, lifecycleDecisions: [lifecycle("retired", "lifecycle-retired")] });
assert.equal(retired.decision, "HOLD");
const degraded = authority.evaluate({ ...evidence, existingPromotion: qualifying.promotion, lifecycleDecisions: [lifecycle("degraded", "lifecycle-degraded")] });
assert.equal(degraded.decision, "REVOKE");
assert.equal(degraded.promotion?.status, "revoked");
promotions.save(degraded.promotion!);
assert.equal(promotions.getForStrategy(strategy.strategyId)?.status, "revoked");
const unsafe = authority.evaluate({ ...evidence, env: { ...env, OANDA_ENV: "live" } });
assert.equal(unsafe.decision, "HOLD");
assert.equal(unsafe.reason, "practice_environment_not_verified");

const runtimePromotions = new InMemoryDemoPromotionRepository();
const runtimeRepositories = {
  strategies: { get: async () => strategy },
  courtroom: { list: async () => evidence.courtCases },
  ranking: { list: async () => evidence.rankings },
  experiments: { list: async () => evidence.experiments },
  backtests: { list: async () => evidence.backtests },
  forwardTesting: { list: async () => evidence.forwardTests },
  evaluations: { listEvaluations: async () => evidence.evaluations },
  lifecycle: { list: async () => evidence.lifecycleDecisions },
  demoPromotions: runtimePromotions,
};
assert.equal(await createAutonomousPracticePromotions({ repositories: runtimeRepositories, config, env, cycleId: "cycle-1", correlationId: "correlation-1", now, limit: 1 }), 1);
assert.equal(await createAutonomousPracticePromotions({ repositories: runtimeRepositories, config, env, cycleId: "cycle-2", correlationId: "correlation-1", now, limit: 1 }), 0);
assert.equal(runtimePromotions.history(strategy.strategyId).length, 1, "runtime retries must remain idempotent");

await assert.rejects(() => createAutonomousPracticePromotions({ repositories: { ...runtimeRepositories, demoPromotions: new InMemoryDemoPromotionRepository() }, config, env, cycleId: "cycle-stale", correlationId: "correlation-1", now, limit: 1, guard: { assertOwned: async () => { throw new Error("lease_lost"); } } as never }), /lease_lost/);

console.log("Autonomous practice promotion authority tests passed");
