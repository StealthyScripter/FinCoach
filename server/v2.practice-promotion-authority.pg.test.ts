import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertDisposableLocalDatabase } from "../scripts/db/dbLifecycle";
import { bootstrapTestDatabase } from "./testDatabase";
import { AutonomousPracticePromotionAuthority, AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY, AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION } from "./v2/execution/promotionAuthority";
import { PgDemoPromotionRepository } from "./v2/execution/promotionRepository";
import { evaluateDemoExecutionEligibility } from "./v2/execution/eligibility";
import { PgOrchestrationRepository } from "./v2/orchestration/pgRepository";
import type { DemoPromotionRecord } from "./v2/execution/contracts";
import type { V2ResearchSignal } from "./v2/signals";
import type { StrategyDefinition } from "./v2/rules";
import type { ForwardTestRecord } from "./v2/forward-testing";

const databaseUrl = process.env.TEST_DATABASE_URL;
assert.equal(process.env.FINCOACH_TEST_DB_DISPOSABLE, "true", "promotion PostgreSQL tests require the disposable harness");
assert.ok(databaseUrl, "TEST_DATABASE_URL is required");
assert.equal(databaseUrl, process.env.DATABASE_URL, "promotion tests must use the harness-selected database");
assertDisposableLocalDatabase(databaseUrl);
const parsedDatabaseUrl = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname), "promotion tests must use a local database");
assert.match(parsedDatabaseUrl.pathname.replace(/^\//, ""), /disposable|test|tmp|temp/i, "promotion tests must use a disposable database name");
assert.equal(process.env.FINCOACH_LIVE_EXECUTION_ENABLED, "false");
assert.equal(process.env.FINCOACH_PAPER_EXECUTION_ENABLED, "false");
assert.equal(process.env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED, "false");
assert.equal(process.env.FINCOACH_DEMO_BROKER_EXECUTION_ENABLED, "true");
assert.equal(process.env.OANDA_ENV, "practice");

await bootstrapTestDatabase(databaseUrl);

const pool = new Pool({ connectionString: databaseUrl });
const suffix = `promotion-pg-${Date.now()}-${randomUUID().slice(0, 8)}`;
const repository = new PgDemoPromotionRepository(pool);
const orchestration = new PgOrchestrationRepository(pool);
const strategyId = `strategy-${suffix}`;
const otherStrategyId = `strategy-other-${suffix}`;
const initial = promotion(`${suffix}-initial`, strategyId, "2026-10-01T12:00:00.000Z", "active", null, true);
const successor = promotion(`${suffix}-successor`, strategyId, "2026-10-02T12:00:00.000Z", "active", initial.promotionId, true);
const revocation = promotion(`${suffix}-revocation`, strategyId, "2026-10-03T12:00:00.000Z", "revoked", successor.promotionId, false);

try {
  await verifyMigrationAndSchema();
  await verifyPromotionPersistence();
  await verifyEligibility();
  await verifyLeaseFencing();
  console.log("Autonomous practice promotion PostgreSQL tests passed");
} finally {
  await pool.query("DELETE FROM v2_demo_promotions WHERE strategy_id IN ($1, $2)", [strategyId, otherStrategyId]);
  await pool.query("DELETE FROM v2_orchestration_worker_leases WHERE lease_name LIKE $1 OR worker_id LIKE $1", [`%${suffix}%`]);
  await pool.end();
}

async function verifyMigrationAndSchema() {
  const migrations = await pool.query("SELECT migration_id FROM fincoach_schema_migrations WHERE status = 'applied' ORDER BY migration_id");
  assert.equal(migrations.rows.at(-1)?.migration_id, "0028_v2_autonomous_practice_promotions");
  assert.ok(migrations.rows.some(row => row.migration_id === "0027_trade_forensics"));

  const columns = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'v2_demo_promotions'");
  assert.equal(columns.rows.find(row => row.column_name === "idempotency_key")?.is_nullable, "YES");
  const indexes = await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'v2_demo_promotions' ORDER BY indexname");
  const indexNames = indexes.rows.map(row => String(row.indexname));
  assert.ok(indexNames.includes("idx_v2_demo_promotions_strategy_created"));
  assert.ok(indexNames.includes("idx_v2_demo_promotions_idempotency"));
  assert.ok(!indexNames.includes("idx_v2_demo_promotions_strategy"));
  assert.match(String(indexes.rows.find(row => row.indexname === "idx_v2_demo_promotions_idempotency")?.indexdef), /UNIQUE/i);
  assert.match(String(indexes.rows.find(row => row.indexname === "idx_v2_demo_promotions_strategy_created")?.indexdef), /strategy_id.*created_at/i);

  await pool.query(
    `INSERT INTO v2_demo_promotions (promotion_id, strategy_id, payload, created_at)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [`${suffix}-legacy`, otherStrategyId, JSON.stringify({ promotionId: `${suffix}-legacy`, strategyId: otherStrategyId, authorizedForPractice: true, approvedBy: "legacy", approvedAt: "2026-09-01T00:00:00.000Z", reason: "legacy row", lineageEventIds: [] }), "2026-09-01T00:00:00.000Z"],
  );
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM v2_demo_promotions WHERE strategy_id = $1", [otherStrategyId])).rows[0]?.total, 1);
}

async function verifyPromotionPersistence() {
  const saved = await repository.save(initial);
  assert.deepEqual(saved, initial);
  assert.equal((await repository.history(strategyId)).length, 1);
  const loaded = await repository.getForStrategy(strategyId);
  assert.equal(loaded?.environment, "practice");
  assert.equal(loaded?.authority, AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY);
  assert.equal(loaded?.approvedBy, AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY);
  assert.equal(loaded?.policyVersion, AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION);
  assert.deepEqual(loaded?.evidenceEventIds, initial.evidenceEventIds);
  assert.equal(loaded?.lifecycleDecisionId, initial.lifecycleDecisionId);
  assert.deepEqual(loaded?.lineageEventIds, initial.lineageEventIds);

  const retries = await Promise.all([repository.save(initial), repository.save(initial), repository.save({ ...initial })]);
  assert.ok(retries.every(record => record?.promotionId === initial.promotionId));
  assert.equal((await repository.history(strategyId)).length, 1, "idempotent retry must not add history");
  const conflictingRetry = await repository.save({ ...initial, promotionId: `${suffix}-conflicting-retry`, approvedAt: "2026-10-01T12:01:00.000Z" });
  assert.equal(conflictingRetry?.promotionId, initial.promotionId, "same idempotency key must return the existing logical promotion");
  assert.equal((await repository.history(strategyId)).length, 1, "conflicting retry must not create partial history");

  await repository.save(successor);
  assert.equal((await repository.history(strategyId)).length, 2, "same strategy must allow append-only history");
  assert.equal((await repository.getForStrategy(strategyId))?.promotionId, successor.promotionId);

  await repository.save(revocation);
  assert.equal((await repository.history(strategyId)).length, 3);
  assert.equal((await repository.history(strategyId))[0]?.promotionId, initial.promotionId);
  assert.equal((await repository.getForStrategy(strategyId))?.status, "revoked");
  assert.equal((await repository.getForStrategy(strategyId))?.supersedesPromotionId, successor.promotionId);

  const authority = new AutonomousPracticePromotionAuthority();
  const rePromotionDecision = authority.evaluate({ ...qualifyingEvidence(`${suffix}-repromotion`, strategyId), existingPromotion: revocation, now: new Date("2026-10-04T12:00:00.000Z") });
  assert.equal(rePromotionDecision.decision, "PROMOTE", "current policy permits re-promotion only after fresh qualifying evidence");
  assert.equal(rePromotionDecision.promotion?.supersedesPromotionId, revocation.promotionId);
  assert.ok(rePromotionDecision.promotion);
  await repository.save(rePromotionDecision.promotion);
  assert.equal((await repository.history(strategyId)).length, 4);
  assert.equal((await repository.getForStrategy(strategyId))?.promotionId, rePromotionDecision.promotion.promotionId);
  assert.equal((await repository.getForStrategy(strategyId))?.status, "active");
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM v2_demo_promotions WHERE strategy_id = $1", [strategyId])).rows[0]?.total, 4);
}

async function verifyEligibility() {
  const active = await repository.getForStrategy(strategyId);
  const input = eligibilityInput(active);
  assert.equal(evaluateDemoExecutionEligibility({ ...input, promotion: null }).reason, "research_only_without_explicit_promotion");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, promotion: active }).reason, "eligible");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, promotion: { ...active!, status: "revoked", authorizedForPractice: false } }).reason, "research_only_without_explicit_promotion");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, promotion: active, lifecycle: { decisionId: `${suffix}-degraded`, toState: "degraded" } }).reason, "lifecycle_state_not_permitted");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, signal: { ...input.signal, lineageEventIds: [`${suffix}-signal-source`] } }).reason, "missing_strategy_lineage");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, promotion: { ...active!, strategyVersion: 2 } }).reason, "research_only_without_explicit_promotion");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, env: { ...process.env, OANDA_ENV: "live" } }).reason, "oanda_environment_not_practice");
  assert.equal(evaluateDemoExecutionEligibility({ ...input, env: { ...process.env, FINCOACH_LIVE_EXECUTION_ENABLED: "true" } }).reason, "live_execution_not_false");
}

async function verifyLeaseFencing() {
  const leaseName = `promotion-lease-${suffix}`;
  const validNow = new Date("2099-01-01T00:00:00.000Z");
  const validLease = await orchestration.acquireLease({ leaseName, workerId: `worker-valid-${suffix}`, now: validNow, ttlMs: 60_000, correlationId: suffix });
  assert.ok(validLease);
  assert.equal(await orchestration.verifyLease({ leaseName, workerId: validLease.workerId, fencingToken: validLease.fencingToken, now: validNow }), true);
  assert.equal((await repository.save(promotion(`${suffix}-lease-valid`, strategyId, "2026-10-05T12:00:00.000Z", "active", `${suffix}-repromotion`, true)))?.promotionId, `${suffix}-lease-valid`);

  const staleLease = await orchestration.acquireLease({ leaseName: `stale-${leaseName}`, workerId: `worker-stale-${suffix}`, now: validNow, ttlMs: 1, correlationId: suffix });
  assert.ok(staleLease);
  const takeover = await orchestration.acquireLease({ leaseName: `stale-${leaseName}`, workerId: `worker-takeover-${suffix}`, now: new Date(validNow.getTime() + 2), ttlMs: 60_000, correlationId: suffix });
  assert.ok(takeover);
  assert.equal(await orchestration.verifyLease({ leaseName: `stale-${leaseName}`, workerId: staleLease.workerId, fencingToken: staleLease.fencingToken, now: new Date(validNow.getTime() + 2) }), false);

  const before = Number((await pool.query("SELECT count(*)::int AS total FROM v2_demo_promotions WHERE promotion_id = $1", [`${suffix}-lease-stale`])).rows[0]?.total ?? 0);
  assert.equal(before, 0);
  await assert.rejects(async () => {
    const owned = await orchestration.verifyLease({ leaseName: `stale-${leaseName}`, workerId: staleLease.workerId, fencingToken: staleLease.fencingToken, now: new Date(validNow.getTime() + 2) });
    if (!owned) throw new Error("lease_lost");
    await repository.save(promotion(`${suffix}-lease-stale`, strategyId, "2026-10-06T12:00:00.000Z", "active", `${suffix}-lease-valid`, true));
  }, /lease_lost/);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS total FROM v2_demo_promotions WHERE promotion_id = $1", [`${suffix}-lease-stale`])).rows[0]?.total ?? 0), 0, "stale worker must not persist promotion");
}

function promotion(id: string, strategy: string, approvedAt: string, status: "active" | "revoked", supersedesPromotionId: string | null, authorizedForPractice: boolean): DemoPromotionRecord {
  const lineage = [`${id}-hypothesis`, `${id}-court`, `${id}-backtest`, `${id}-forward`, `${id}-lifecycle`];
  return {
    promotionId: id, strategyId: strategy, strategyVersion: 1, authorizedForPractice, status, environment: "practice",
    authority: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY, approvedBy: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY, approvedAt,
    reason: status === "active" ? "qualifying autonomous evidence" : "newer adverse lifecycle state", evidenceEventIds: lineage,
    lifecycleDecisionId: `${id}-lifecycle`, forwardTestIds: [`${id}-forward`], evaluationIds: [`${id}-evaluation`],
    policyVersion: AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION, idempotencyKey: `${id}-idempotency`, correlationId: suffix,
    causationId: `${id}-causation`, supersedesPromotionId, lineageEventIds: lineage,
  };
}

function qualifyingEvidence(id: string, strategy: string) {
  const hypothesisId = `${id}-hypothesis`;
  const courtCaseId = `${id}-court`;
  const experimentId = `${id}-experiment`;
  const backtestId = `${id}-backtest`;
  const rankingId = `${id}-ranking`;
  const forwardTestId = `${id}-forward`;
  const lifecycleDecisionId = `${id}-lifecycle`;
  const strategyVersion = 1;
  const lineageEventIds = [hypothesisId, `${id}-lineage`];
  const strategyRecord = { strategyId: strategy, strategyVersion, hypothesisId, lineageEventIds } as unknown as StrategyDefinition & { lineageEventIds: string[] };
  const lifecycle = [{ decisionId: lifecycleDecisionId, strategyId: strategy, fromState: "forward-test", toState: "candidate", reason: "fresh qualifying lifecycle", metrics: { expectancy: 0.5, drawdown: 2, calibration: 0.8, evidenceAgeDays: 1, regimeMismatch: 0, externalDisagreement: 0, edgeDecay: 0 }, createdAt: "2026-10-04T11:00:00.000Z", lineageEventIds: [`${id}-lifecycle-lineage`], schemaVersion: "fincoach.v2.strategy-lifecycle.1", correlationId: suffix, causationId: null }];
  const court = [{ caseId: courtCaseId, strategyId: strategy, strategyVersion, hypothesisId, experimentIds: [experimentId], backtestIds: [backtestId], verdict: "approve_for_replay", createdAt: "2026-10-04T01:00:00.000Z", lineageEventIds: [`${id}-court-lineage`] }];
  const ranking = [{ rankingId, generatedAt: "2026-10-04T02:00:00.000Z", candidates: [{ strategyId: strategy, strategyVersion, hypothesisId, courtCaseId, status: "candidate", metrics: { oosExpectancy: 0.5, maxDrawdown: 4 } }], lineageEventIds: [`${id}-ranking-lineage`] }];
  const experiment = [{ experimentId, strategyId: strategy, strategyVersion, datasetSpecification: { start: "2026-01-01T00:00:00.000Z", end: "2026-04-15T00:00:00.000Z" }, status: "completed", lineageEventIds: [`${id}-experiment-lineage`] }];
  const backtest = [{ backtestId, strategyId: strategy, strategyVersion, status: "completed", aggregateMetrics: { tradeCount: 100, expectancy: 0.2, maxDrawdown: 4 }, warnings: [], lineageEventIds: [`${id}-backtest-lineage`] }];
  const forwardTest = [{ forwardTestId, strategyId: strategy, strategyVersion, courtCaseId, rankingId, status: "completed", demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice" }, lineageEventIds: [`${id}-forward-lineage`] }];
  const evaluations = Array.from({ length: 30 }, (_, index) => ({ evaluationId: `${id}-evaluation-${index}`, strategyId: strategy, forwardTestId, evaluationSource: "research_candles", outcome: index < 20 ? "tp" : "sl", r: index < 20 ? 1 : -0.5, evaluatedAt: new Date(Date.parse("2026-09-01T12:00:00.000Z") + index * 12 * 60 * 60_000).toISOString(), lineageEventIds: [`${id}-evaluation-lineage-${index}`] }));
  return {
    strategy: strategyRecord, courtCases: court as never, rankings: ranking as never, experiments: experiment as never, backtests: backtest as never,
    forwardTests: forwardTest as unknown as ForwardTestRecord[], evaluations: evaluations as never, lifecycleDecisions: lifecycle as never,
    config: { minBacktestTrades: 100, minBacktestDays: 90, minForwardTestTrades: 30, minForwardTestDays: 14, minProfitFactor: 1.2, maxDrawdownPct: 10, minSharpeRatio: 0.5 },
    env: process.env, now: new Date("2026-10-04T12:00:00.000Z"), correlationId: suffix, causationId: lifecycleDecisionId,
  };
}

function eligibilityInput(promotion: DemoPromotionRecord | null) {
  const signal = {
    schema: "fincoach.signal.v2", signalId: `${suffix}-signal`, symbol: "EUR/USD", side: "buy", entryPrice: 1.1, stopLoss: 1.09,
    takeProfit: 1.12, timeframe: "1m", strategyId, strategyVersion: 1, courtCaseId: `${suffix}-court`, forwardTestId: `${suffix}-forward`,
    confidence: 0.9, evidenceScore: 0.9, validUntil: "2099-01-01T01:00:00.000Z", demoOnly: true, createdAt: "2099-01-01T00:00:00.000Z",
    lineageEventIds: [strategyId, `${suffix}-signal-source`], correlationId: suffix, causationId: `${suffix}-cause`,
  } as unknown as V2ResearchSignal;
  const strategy = { strategyId, strategyVersion: 1, researchOnly: true } as StrategyDefinition & { researchOnly: boolean };
  const forwardTest = {
    forwardTestId: `${suffix}-forward`, strategyId, strategyVersion: 1, courtCaseId: `${suffix}-court`, rankingId: `${suffix}-ranking`, status: "completed",
    demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: "2098-12-01T00:00:00.000Z" },
    lineageEventIds: [`${suffix}-forward-source`],
  } as unknown as ForwardTestRecord;
  return {
    signal, strategy, forwardTest, lifecycle: { decisionId: `${suffix}-lifecycle`, toState: "candidate" }, promotion,
    killSwitchActive: false, practiceCapacityAvailable: true, env: process.env,
  };
}
