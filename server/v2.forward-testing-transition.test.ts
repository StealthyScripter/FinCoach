import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { createForwardTestsFromRanking } from "./v2/runtime/composition";
import { InMemoryForwardTestingRepository } from "./v2/forward-testing/repository";
import { PgForwardTestingRepository } from "./v2/forward-testing/pgRepository";
import type { BacktestResult } from "./v2/backtesting";
import type { ForwardTestRecord } from "./v2/forward-testing";
import type { RankedStrategy, StrategyRankingDecision } from "./v2/ranking";
import type { StrategyDefinition } from "./v2/rules";

const correlationId = "11111111-1111-4111-8111-111111111111";
const rankingEventId = "22222222-2222-4222-8222-222222222222";

await rankedCandidateCreatesForwardTest();
await historicalReplayApprovalCreatesForwardTest();
await rejectedVerdictDoesNotCreateForwardTest();
await inconclusiveVerdictDoesNotCreateForwardTest();
await unknownVerdictFailsClosed();
await featureFlagDisabledBlocksCreation();
await zeroForwardTestLimitBlocksCreation();
await duplicateRuntimeCycleDoesNotCreateAnotherForwardTest();
await duplicatePersistenceResultSkipsCreation();
await multipleRankedCandidatesCreateIndependentForwardTests();
await budgetStopsAfterInsertedLimit();
await persistenceFailureDoesNotAbortRemainingCandidates();
await repositoryParity();

async function rankedCandidateCreatesForwardTest() {
  const repository = new InMemoryForwardTestingRepository();
  const ranking = fixtureRanking([fixtureCandidate("one")]);
  const count = await runTransition(ranking, repository);
  assert.equal(count, 1);
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].rankingId, ranking.rankingId);
  assert.equal(repository.list()[0].causationId, rankingEventId);
  assert.ok(repository.list()[0].lineageEventIds.includes(rankingEventId));
}

async function historicalReplayApprovalCreatesForwardTest() {
  const repository = new InMemoryForwardTestingRepository();
  assert.equal(await runTransition(fixtureRanking([fixtureCandidate("replay", { courtVerdict: "approve_for_replay" })]), repository), 1);
  assert.equal(repository.list().length, 1);
}

async function rejectedVerdictDoesNotCreateForwardTest() {
  const repository = new InMemoryForwardTestingRepository();
  assert.equal(await runTransition(fixtureRanking([fixtureCandidate("reject", { courtVerdict: "reject" })]), repository), 0);
  assert.equal(repository.list().length, 0);
}

async function inconclusiveVerdictDoesNotCreateForwardTest() {
  for (const verdict of ["watch", "revise"] as const) {
    const repository = new InMemoryForwardTestingRepository();
    assert.equal(await runTransition(fixtureRanking([fixtureCandidate(`inconclusive-${verdict}`, { courtVerdict: verdict })]), repository), 0);
    assert.equal(repository.list().length, 0);
  }
}

async function unknownVerdictFailsClosed() {
  const repository = new InMemoryForwardTestingRepository();
  assert.equal(await runTransition(fixtureRanking([fixtureCandidate("unknown", { courtVerdict: "unknown" as never })]), repository), 0);
  assert.equal(repository.list().length, 0);
}

async function featureFlagDisabledBlocksCreation() {
  const repository = new InMemoryForwardTestingRepository();
  assert.equal(await runTransition(fixtureRanking([fixtureCandidate("flag-disabled")]), repository, { forwardTestingEnabled: false }), 0);
  assert.equal(repository.list().length, 0);
}

async function zeroForwardTestLimitBlocksCreation() {
  const repository = new InMemoryForwardTestingRepository();
  assert.equal(await runTransition(fixtureRanking([fixtureCandidate("zero-limit")]), repository, { maxActiveForwardTests: 0 }), 0);
  assert.equal(repository.list().length, 0);
}

async function duplicateRuntimeCycleDoesNotCreateAnotherForwardTest() {
  const repository = new InMemoryForwardTestingRepository();
  const ranking = fixtureRanking([fixtureCandidate("duplicate-cycle")]);
  assert.equal(await runTransition(ranking, repository), 1);
  assert.equal(await runTransition(ranking, repository), 0);
  assert.equal(repository.list().length, 1);
}

async function duplicatePersistenceResultSkipsCreation() {
  const candidate = fixtureCandidate("duplicate-save");
  const existing = fixtureForwardTest(candidate);
  const repository = {
    async save() {
      return { inserted: false, record: existing, conflict: "idempotent" as const };
    },
  };
  assert.equal(await runTransition(fixtureRanking([candidate]), repository), 0);
}

async function multipleRankedCandidatesCreateIndependentForwardTests() {
  const repository = new InMemoryForwardTestingRepository();
  const ranking = fixtureRanking([fixtureCandidate("multi-a"), fixtureCandidate("multi-b")]);
  assert.equal(await runTransition(ranking, repository, { maxActiveForwardTests: 5 }), 2);
  assert.equal(repository.list().length, 2);
  assert.notEqual(repository.list()[0].forwardTestId, repository.list()[1].forwardTestId);
}

async function budgetStopsAfterInsertedLimit() {
  const candidates = [fixtureCandidate("budget-dup"), fixtureCandidate("budget-insert-a"), fixtureCandidate("budget-insert-b")];
  const duplicate = fixtureForwardTest(candidates[0]);
  const inserted: ForwardTestRecord[] = [];
  const repository = {
    async save(record: ForwardTestRecord) {
      if (record.courtCaseId === candidates[0].courtCaseId) return { inserted: false, record: duplicate, conflict: "idempotent" as const };
      inserted.push(record);
      return { inserted: true, record };
    },
  };
  assert.equal(await runTransition(fixtureRanking(candidates), repository, { maxActiveForwardTests: 1 }), 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].courtCaseId, candidates[1].courtCaseId);
}

async function persistenceFailureDoesNotAbortRemainingCandidates() {
  const inserted: ForwardTestRecord[] = [];
  let attempts = 0;
  const repository = {
    async save(record: ForwardTestRecord) {
      attempts += 1;
      if (attempts === 1) throw new Error("fixture persistence failure");
      inserted.push(record);
      return { inserted: true, record };
    },
  };
  const ranking = fixtureRanking([fixtureCandidate("fail-first"), fixtureCandidate("after-failure")]);
  assert.equal(await runTransition(ranking, repository, { maxActiveForwardTests: 2 }), 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].courtCaseId, "court-after-failure");
}

async function repositoryParity() {
  const record = fixtureForwardTest(fixtureCandidate("parity"));
  const memory = new InMemoryForwardTestingRepository();
  const memoryInserted = await memory.save(record);
  const memoryDuplicate = await memory.save(record);
  assert.deepEqual({ inserted: memoryInserted.inserted, conflict: memoryInserted.conflict ?? null }, { inserted: true, conflict: null });
  assert.deepEqual({ inserted: memoryDuplicate.inserted, conflict: memoryDuplicate.conflict ?? null }, { inserted: false, conflict: "idempotent" });

  if (!process.env.DATABASE_URL) return;
  await bootstrapTestDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(readFileSync("migrations/0016_v2_research_lineage_persistence.sql", "utf-8"));
    const pg = new PgForwardTestingRepository(pool);
    const pgInserted = await pg.save(record);
    const pgDuplicate = await pg.save(record);
    assert.deepEqual({ inserted: pgInserted.inserted, conflict: pgInserted.conflict ?? null }, { inserted: memoryInserted.inserted, conflict: memoryInserted.conflict ?? null });
    assert.deepEqual({ inserted: pgDuplicate.inserted, conflict: pgDuplicate.conflict ?? null }, { inserted: memoryDuplicate.inserted, conflict: memoryDuplicate.conflict ?? null });
  } finally {
    await pool.query("DELETE FROM v2_forward_tests WHERE record_id = $1", [record.forwardTestId]).catch(() => undefined);
    await pool.end();
  }
}

async function runTransition(
  ranking: StrategyRankingDecision,
  repository: { save(record: ForwardTestRecord): unknown },
  options: { forwardTestingEnabled?: boolean; maxActiveForwardTests?: number } = {},
) {
  return await createForwardTestsFromRanking({
    repositories: { forwardTesting: repository },
    config: { forwardTestingEnabled: options.forwardTestingEnabled ?? true, maxActiveForwardTests: options.maxActiveForwardTests ?? 3 },
    ranking,
    rankingEventId,
    sources: new Map(ranking.candidates.map(candidate => [sourceKey(candidate), { strategy: fixtureStrategy(candidate), backtest: fixtureBacktest(candidate), courtEventId: `court-event-${candidate.courtCaseId}` }])),
    cycleId: "cycle-forward-test",
    correlationId,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
}

function fixtureRanking(candidates: RankedStrategy[]): StrategyRankingDecision {
  return {
    rankingId: `ranking-${candidates.map(candidate => candidate.strategyId).join("-")}`,
    policyVersion: "fincoach.v2.ranking.policy.1",
    generatedAt: "2026-07-30T12:00:00.000Z",
    candidates,
    focusedPortfolio: { maxFocusedCount: candidates.length, strategies: candidates, constraints: {} },
    demotions: [],
    retirements: [],
    evidenceGaps: [],
    correlationMatrixReference: "corr-fixture",
    correlationId,
    causationId: rankingEventId,
  };
}

function fixtureCandidate(label: string, overrides: Partial<RankedStrategy> = {}): RankedStrategy {
  return {
    strategyId: `strategy-${label}`,
    strategyVersion: 1,
    hypothesisId: `hypothesis-${label}`,
    courtCaseId: `court-${label}`,
    courtVerdict: "approve_for_forward_test",
    metrics: { oosExpectancy: 0.4, confidenceInterval: 0.1, sampleDepth: 80, walkForwardStability: 0.8, parameterRobustness: 0.8, costResilience: 0.8, maxDrawdown: 0.05, tailRisk: 0.1, regimeDiversity: 0.7, operationalComplexity: 0.2, turnover: 0.1, exposure: 0.2 },
    similarityConfidence: 0.8,
    evidenceFreshness: 1,
    lineageEventIds: [`backtest-event-${label}`, `court-event-${label}`],
    assetClass: "forex",
    timeframe: "1m",
    horizon: "short",
    correlationCluster: "fixture",
    rawReturn: 0.5,
    score: 1,
    rank: 1,
    status: "candidate",
    reasons: [],
    ...overrides,
  };
}

function fixtureStrategy(candidate: Pick<RankedStrategy, "strategyId" | "strategyVersion" | "hypothesisId">): StrategyDefinition {
  return {
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    schemaVersion: "fincoach.v2.strategy.1",
    hypothesisId: candidate.hypothesisId,
    name: `Fixture ${candidate.strategyId}`,
    assetClasses: ["forex"],
    symbols: ["EUR_USD"],
    timeframes: ["1m"],
    entryConditions: [{ field: "observationType", operator: "in", value: ["breakout"] }],
    filters: [],
    sidePolicy: { candidateSide: "buy" },
    stopLoss: { type: "atr_multiple", value: 1.5 },
    takeProfit: { type: "atr_multiple", value: 2 },
    timeExit: { type: "time", value: "1h" },
    invalidationRules: [],
    positionSizing: { type: "fixed_fractional", riskFraction: 0.001 },
    costModel: { costModelId: "fixture", version: "v1" },
    sessionRestrictions: [],
    eventRestrictions: [],
    supportedRegimes: ["demo"],
    requiredFeatureDefinitions: [],
    complexityScore: 1,
    fingerprint: `fingerprint-${candidate.strategyId}`,
    createdAt: "2026-07-30T12:00:00.000Z",
    correlationId,
    causationId: "hypothesis-event",
  };
}

function fixtureBacktest(candidate: Pick<RankedStrategy, "strategyId" | "strategyVersion">): BacktestResult {
  return {
    backtestId: `backtest-${candidate.strategyId}`,
    experimentId: `experiment-${candidate.strategyId}`,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    datasetFingerprint: "dataset-fixture",
    engineVersion: "fixture",
    costModelVersion: "fixture",
    fillModelVersion: "fixture",
    randomSeed: "fixture",
    partitions: [],
    aggregateMetrics: { netProfit: 1, grossProfit: 1, grossLoss: 0, profitFactor: 2, expectancy: 0.4, averageR: 0.4, medianR: 0.4, winRate: 0.6, lossRate: 0.4, maxDrawdown: 0.05, tradeCount: 40, sampleDepth: 80, costSensitivity: 0.1, stability: 0.8 },
    trades: [],
    warnings: [],
    lineageEventIds: [`backtest-event-${candidate.strategyId}`],
    status: "completed",
    createdAt: "2026-07-30T12:00:00.000Z",
    correlationId,
    causationId: "experiment-event",
  };
}

function fixtureForwardTest(candidate: RankedStrategy): ForwardTestRecord {
  const strategy = fixtureStrategy(candidate);
  return {
    forwardTestId: `forward-${candidate.strategyId}`,
    schemaVersion: "fincoach.v2.forward-test.1",
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    courtCaseId: candidate.courtCaseId,
    rankingId: "ranking-fixture",
    status: "monitoring",
    demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: "2026-07-30T12:00:00.000Z" },
    snapshot: { snapshotId: `snapshot-${candidate.strategyId}`, symbol: "EUR_USD", timestamp: "2026-07-30T12:00:00.000Z", bid: 1, ask: 1.0002, spread: 0.0002, fresh: true, contextEventId: rankingEventId, lineageEventIds: candidate.lineageEventIds },
    ruleEvaluation: { entryConditions: strategy.entryConditions.length, filters: strategy.filters.length },
    reason: "fixture",
    counterargument: "fixture",
    expectedR: 0.4,
    risk: 0.001,
    createdAt: "2026-07-30T12:00:00.000Z",
    lineageEventIds: [...candidate.lineageEventIds, rankingEventId],
    correlationId,
    causationId: rankingEventId,
  };
}

function sourceKey(candidate: Pick<RankedStrategy, "strategyId" | "strategyVersion" | "courtCaseId">) {
  return `${candidate.strategyId}:${candidate.strategyVersion}:${candidate.courtCaseId}`;
}

console.log("v2 forward-testing transition tests passed");
