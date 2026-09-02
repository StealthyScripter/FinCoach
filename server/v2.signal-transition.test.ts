import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { InMemoryForwardTestingRepository, type ForwardTestRecord } from "./v2/forward-testing";
import { PgForwardTestingRepository } from "./v2/forward-testing/pgRepository";
import { InMemorySignalRepository, type V2ResearchSignal } from "./v2/signals";
import { PgSignalRepository } from "./v2/signals/pgRepository";
import { evaluateSignalEligibility } from "./v2/signals";
import { InMemoryExternalEvaluationRepository } from "./v2/external-evaluation/repository";
import { InMemoryResearchJournalRepository } from "./v2/journal/repository";
import { InMemoryLearningRepository } from "./v2/learning/repository";
import { InMemoryStrategyLifecycleRepository } from "./v2/strategy-lifecycle/repository";
import { PgStrategyLifecycleRepository } from "./v2/strategy-lifecycle/pgRepository";
import { createEvaluationsFromSignals, createJournalEntriesFromEvaluations, createLessonsFromJournalEntries, createLifecycleDecisionsFromLessons, createSignalsFromForwardTests } from "./v2/runtime/composition";
import { evaluateSignalFromFrozenCandles } from "./v2/runtime/signalOutcomeEvaluator";
import type { NormalizedCandle } from "./v2/market-data";

const now = new Date("2026-07-30T12:00:00.000Z");
const correlationId = "33333333-3333-4333-8333-333333333333";
const causationId = "44444444-4444-4444-8444-444444444444";

await eligibleCompletedForwardTestCreatesSignal();
await dedicatedSignalBudgetIndependentFromForwardTestLimit();
await ineligibleForwardTestStatusCreatesNoSignal();
await unknownForwardTestStatusFailsClosed();
await featureFlagDisabledBlocksSignalCreation();
await zeroActiveSignalLimitBlocksCreation();
await duplicateSignalSaveDoesNotIncrementCount();
await duplicateSaveDoesNotConsumeInsertionBudget();
await persistenceFailureContinues();
await multipleEligibleForwardTestsCreateIndependentSignals();
await repeatedRuntimeCycleIsIdempotent();
await expiredSignalsDoNotConsumeCapacity();
await activeSignalsConsumeCapacity();
await activeSignalBoundaryIsDeterministic();
await historicalEligibleForwardTestCreatesSignal();
await expiredAndSupersededForwardTestsExcluded();
await repositoryParity();
await statusContractCannotDrift();
await fullPostSignalLifecycleRunsExactlyOnce();
await frozenCandleEvaluationCases();
await unresolvedStrategyFailsClosed();
await evaluationCompletionRetriesAfterPartialFailure();
await resolvedStrategyIdOverridesLessonTopic();

async function eligibleCompletedForwardTestCreatesSignal() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("completed", { status: "completed" }));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals), 1);
  assert.equal(signals.list().length, 1);
  assert.equal(signals.list()[0].forwardTestId, "forward-completed");
}

async function dedicatedSignalBudgetIndependentFromForwardTestLimit() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("budget-independent-a"));
  await forwardTesting.save(fixtureForwardTest("budget-independent-b"));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveResearchSignals: 2, maxActiveForwardTests: 0 }), 2);
}

async function ineligibleForwardTestStatusCreatesNoSignal() {
  for (const status of ["blocked", "failed", "cancelled"] as const) {
    const forwardTesting = new InMemoryForwardTestingRepository();
    await forwardTesting.save(fixtureForwardTest(`ineligible-${status}`, { status }));
    const signals = new InMemorySignalRepository();
    assert.equal(await runTransition(forwardTesting, signals), 0);
    assert.equal(signals.list().length, 0);
  }
}

async function unknownForwardTestStatusFailsClosed() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("unknown", { status: "unknown" as never }));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals), 0);
}

async function featureFlagDisabledBlocksSignalCreation() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("feature-disabled"));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals, { researchSignalEnabled: false }), 0);
  assert.equal(signals.list().length, 0);
}

async function zeroActiveSignalLimitBlocksCreation() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("zero-limit"));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveForwardTests: 0 }), 0);
}

async function duplicateSignalSaveDoesNotIncrementCount() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("duplicate"));
  const existing = fixtureSignal("duplicate");
  const signals = {
    async save() {
      return { inserted: false, signal: existing, record: existing, conflict: "idempotent" as const };
    },
    listPage: () => ({ total: 0 }),
  };
  assert.equal(await runTransition(forwardTesting, signals), 0);
}

async function duplicateSaveDoesNotConsumeInsertionBudget() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("dup-budget-a", { createdAt: "2026-07-30T12:02:00.000Z" }));
  await forwardTesting.save(fixtureForwardTest("dup-budget-b", { createdAt: "2026-07-30T12:01:00.000Z" }));
  const inserted: V2ResearchSignal[] = [];
  const duplicate = fixtureSignal("dup-budget-a");
  const signals = {
    async save(signal: V2ResearchSignal) {
      if (signal.forwardTestId === "forward-dup-budget-a") return { inserted: false, signal: duplicate, record: duplicate, conflict: "idempotent" as const };
      inserted.push(signal);
      return { inserted: true, signal, record: signal };
    },
    listPage: () => ({ total: 0 }),
  };
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveForwardTests: 1 }), 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].forwardTestId, "forward-dup-budget-b");
}

async function persistenceFailureContinues() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("fail-first", { createdAt: "2026-07-30T12:02:00.000Z" }));
  await forwardTesting.save(fixtureForwardTest("after-failure", { createdAt: "2026-07-30T12:01:00.000Z" }));
  const inserted: V2ResearchSignal[] = [];
  let attempts = 0;
  const signals = {
    async save(signal: V2ResearchSignal) {
      attempts += 1;
      if (attempts === 1) throw new Error("fixture signal persistence failure");
      inserted.push(signal);
      return { inserted: true, signal, record: signal };
    },
    listPage: () => ({ total: 0 }),
  };
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveForwardTests: 2 }), 1);
  assert.equal(inserted[0].forwardTestId, "forward-after-failure");
}

async function multipleEligibleForwardTestsCreateIndependentSignals() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("multi-a"));
  await forwardTesting.save(fixtureForwardTest("multi-b"));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveForwardTests: 5 }), 2);
  assert.equal(signals.list().length, 2);
  assert.notEqual(signals.list()[0].signalId, signals.list()[1].signalId);
}

async function repeatedRuntimeCycleIsIdempotent() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("repeat"));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals), 1);
  assert.equal(await runTransition(forwardTesting, signals), 0);
  assert.equal(signals.list().length, 1);
}

async function expiredSignalsDoNotConsumeCapacity() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("expired-capacity"));
  const signals = new InMemorySignalRepository();
  for (let index = 0; index < 20; index += 1) await signals.save(fixtureSignal(`expired-history-${index}`, { validUntil: "2026-07-30T11:59:59.999Z" }));
  assert.equal(signals.countActive(now), 0);
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveResearchSignals: 20 }), 1);
}

async function activeSignalsConsumeCapacity() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("one-slot"));
  await forwardTesting.save(fixtureForwardTest("no-second-slot", { createdAt: "2026-07-30T11:59:00.000Z" }));
  const signals = new InMemorySignalRepository();
  for (let index = 0; index < 19; index += 1) await signals.save(fixtureSignal(`active-${index}`));
  for (let index = 0; index < 30; index += 1) await signals.save(fixtureSignal(`expired-extra-${index}`, { validUntil: "2026-07-30T11:00:00.000Z" }));
  assert.equal(signals.countActive(now), 19);
  assert.equal(await runTransition(forwardTesting, signals, { maxActiveResearchSignals: 20 }), 1);
  assert.equal(signals.countActive(now), 20);
  const blockedForward = new InMemoryForwardTestingRepository();
  await blockedForward.save(fixtureForwardTest("blocked-at-20"));
  assert.equal(await runTransition(blockedForward, signals, { maxActiveResearchSignals: 20 }), 0);
}

async function activeSignalBoundaryIsDeterministic() {
  const signals = new InMemorySignalRepository();
  await signals.save(fixtureSignal("boundary", { validUntil: now.toISOString() }));
  assert.equal(signals.countActive(new Date(now.getTime() - 1)), 1);
  assert.equal(signals.countActive(now), 0);
}

async function historicalEligibleForwardTestCreatesSignal() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("historical", { createdAt: "2026-07-30T10:00:00.000Z" }));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals), 1);
}

async function expiredAndSupersededForwardTestsExcluded() {
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("expired", { expiresAt: "2026-07-30T11:59:00.000Z" } as Partial<ForwardTestRecord>));
  await forwardTesting.save(fixtureForwardTest("superseded", { supersedesId: "forward-newer" } as Partial<ForwardTestRecord>));
  const signals = new InMemorySignalRepository();
  assert.equal(await runTransition(forwardTesting, signals), 0);
  assert.equal(signals.list().length, 0);
}

async function repositoryParity() {
  const fixtures = [
    fixtureForwardTest("parity-a", { createdAt: "2026-07-30T12:02:00.000Z" }),
    fixtureForwardTest("parity-b", { createdAt: "2026-07-30T12:01:00.000Z", status: "completed" }),
    fixtureForwardTest("parity-blocked", { status: "blocked" }),
  ];
  const memoryForward = new InMemoryForwardTestingRepository();
  for (const record of fixtures) await memoryForward.save(record);
  assert.deepEqual((await memoryForward.eligibleForSignal({ now, limit: 10 })).map(record => record.forwardTestId), ["forward-parity-a", "forward-parity-b"]);

  const memorySignals = new InMemorySignalRepository();
  const signal = fixtureSignal("parity-a");
  assert.equal((await memorySignals.save(signal)).inserted, true);
  assert.equal((await memorySignals.save(signal)).conflict, "idempotent");
  assert.equal(memoryForward.countActive(), 1);
  const memoryCompleted = memoryForward.complete("forward-parity-a", "evaluation-parity", new Date("2026-07-30T13:00:00.000Z"));
  assert.equal(memoryCompleted.inserted, true);
  assert.equal(memoryForward.complete("forward-parity-a", "evaluation-parity", new Date("2026-07-30T13:00:00.000Z")).inserted, false);
  assert.equal(memoryForward.countActive(), 0);
  assert.equal((await memoryForward.eligibleForSignal({ now: new Date("2026-07-30T13:00:00.000Z"), limit: 10 })).some(record => record.forwardTestId === "forward-parity-a"), false);

  if (!process.env.DATABASE_URL) return;
  await bootstrapTestDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(readFileSync("migrations/0016_v2_research_lineage_persistence.sql", "utf-8"));
    const pgForward = new PgForwardTestingRepository(pool);
    const pgSignals = new PgSignalRepository(pool);
    for (const record of fixtures) await pgForward.save(record);
    assert.deepEqual((await pgForward.eligibleForSignal({ now, limit: 10 })).map(record => record.forwardTestId), ["forward-parity-a", "forward-parity-b"]);
    const pgInserted = await pgSignals.save(signal);
    const pgDuplicate = await pgSignals.save(signal);
    assert.equal(pgInserted.inserted, true);
    assert.equal(pgDuplicate.conflict, "idempotent");
    assert.equal(await pgSignals.countActive(now), 1);
    assert.equal(await pgForward.countActive(), 1);
    assert.equal((await pgForward.complete("forward-parity-a", "evaluation-parity", new Date("2026-07-30T13:00:00.000Z"))).inserted, true);
    assert.equal((await pgForward.complete("forward-parity-a", "evaluation-parity", new Date("2026-07-30T13:00:00.000Z"))).inserted, false);
    assert.equal(await pgForward.countActive(), 0);
    const reloadedForward = new PgForwardTestingRepository(pool);
    assert.equal(await reloadedForward.countActive(), 0);
    assert.equal((await reloadedForward.eligibleForSignal({ now: new Date("2026-07-30T13:00:00.000Z"), limit: 10 })).some(record => record.forwardTestId === "forward-parity-a"), false);
    assert.equal((await reloadedForward.list({ strategyId: "strategy-parity-a" })).some(record => record.status === "completed" && record.supersedesId === "forward-parity-a"), true);
    const pgLifecycle = new PgStrategyLifecycleRepository(pool);
    const durableLearning = new InMemoryLearningRepository({ lessons: [{ lessonId: "durable-lineage-lesson", schemaVersion: "fincoach.v2.learning-lesson.1", topic: "strategy-parity-a", strategyId: "strategy-parity-a", attribution: { primaryCause: "tp", supportingCauses: [], positiveSamples: 1, negativeSamples: 0, averageR: 1 }, confidence: 0.7, evidenceJournalEntryIds: ["journal-parity"], limitations: [], createdAt: now.toISOString(), supersedesLessonId: null, lineageEventIds: [causationId, "forward-parity-a", signal.signalId, "evaluation-parity", "journal-parity"], correlationId, causationId }] });
    assert.equal(await createLifecycleDecisionsFromLessons({ repositories: { learning: durableLearning, lifecycle: pgLifecycle, strategies: { get: id => id === "strategy-parity-a" ? { strategyId: id } as never : null } }, cycleId: "durable-lineage", correlationId, now, limit: 1 }), 1);
    const reloadedLifecycle = new PgStrategyLifecycleRepository(pool);
    const durableHistory = await reloadedLifecycle.history("strategy-parity-a");
    assert.equal(durableHistory.length, 1);
    assert.equal(durableHistory[0].strategyId, "strategy-parity-a");
    assert.equal(durableHistory[0].lineageEventIds.includes(signal.signalId), true);
  } finally {
    await pool.query("DELETE FROM v2_forward_tests WHERE payload->>'strategyId' LIKE 'strategy-parity-%'").catch(() => undefined);
    await pool.query("DELETE FROM v2_research_signals WHERE record_id = $1", [signal.signalId]).catch(() => undefined);
    await pool.query("DELETE FROM v2_strategy_lifecycle_decisions WHERE payload->>'strategyId' = 'strategy-parity-a'").catch(() => undefined);
    await pool.end();
  }
}

async function statusContractCannotDrift() {
  assert.equal(evaluateSignalEligibility(fixtureForwardTest("contract-monitoring", { status: "monitoring" })).eligible, true);
  assert.equal(evaluateSignalEligibility(fixtureForwardTest("contract-completed", { status: "completed" })).eligible, true);
  assert.equal(evaluateSignalEligibility(fixtureForwardTest("contract-blocked", { status: "blocked" })).eligible, false);
  assert.equal(evaluateSignalEligibility(fixtureForwardTest("contract-unknown", { status: "unknown" as never })).reason, "unknown_forward_test_status");
}

async function fullPostSignalLifecycleRunsExactlyOnce() {
  const signals = new InMemorySignalRepository();
  await signals.save(fixtureSignal("full-chain"));
  const evaluations = new InMemoryExternalEvaluationRepository();
  const journal = new InMemoryResearchJournalRepository();
  const learning = new InMemoryLearningRepository();
  const lifecycle = new InMemoryStrategyLifecycleRepository();
  const forwardTesting = new InMemoryForwardTestingRepository();
  await forwardTesting.save(fixtureForwardTest("full-chain"));
  const evaluationNow = new Date("2026-07-30T13:00:00.000Z");
  const strategies = { get: (id: string) => id === "strategy-full-chain" ? { strategyId: id } as never : null };
  assert.equal(await createEvaluationsFromSignals({ repositories: { signals, evaluations, forwardTesting }, marketData: { candlesForSignal: () => [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 1.0001)] }, cycleId: "cycle-chain", correlationId, now: evaluationNow, limit: 3 }), 1);
  assert.equal(await createJournalEntriesFromEvaluations({ repositories: { evaluations, journal }, cycleId: "cycle-chain", correlationId, now, limit: 3 }), 1);
  assert.equal(await createLessonsFromJournalEntries({ repositories: { journal, learning }, cycleId: "cycle-chain", correlationId, limit: 3 }), 1);
  assert.equal(await createLifecycleDecisionsFromLessons({ repositories: { learning, lifecycle, strategies }, cycleId: "cycle-chain", correlationId, now: evaluationNow, limit: 3 }), 1);
  assert.equal(await createEvaluationsFromSignals({ repositories: { signals, evaluations, forwardTesting }, marketData: { candlesForSignal: () => [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 1.0001)] }, cycleId: "cycle-chain-2", correlationId, now: evaluationNow, limit: 3 }), 0);
  assert.equal(await createJournalEntriesFromEvaluations({ repositories: { evaluations, journal }, cycleId: "cycle-chain-2", correlationId, now, limit: 3 }), 0);
  assert.equal(await createLessonsFromJournalEntries({ repositories: { journal, learning }, cycleId: "cycle-chain-2", correlationId, limit: 3 }), 0);
  assert.equal(await createLifecycleDecisionsFromLessons({ repositories: { learning, lifecycle, strategies }, cycleId: "cycle-chain-2", correlationId, now: evaluationNow, limit: 3 }), 0);
  assert.equal(lifecycle.list().length, 1);
  assert.equal(lifecycle.list()[0].strategyId, "strategy-full-chain");
  assert.equal(lifecycle.list()[0].lineageEventIds.includes("signal-full-chain"), true);
  assert.equal(forwardTesting.countActive(), 0);
  assert.equal(forwardTesting.list().some(record => record.status === "completed" && record.supersedesId === "forward-full-chain"), true);
}

async function frozenCandleEvaluationCases() {
  const signal = fixtureSignal("evaluator");
  const at = new Date(signal.validUntil);
  const tp = evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 1.0001)], at);
  assert.equal(tp.evaluation?.outcome, "tp");
  assert.equal(tp.evaluation?.r, 1.5);
  const sl = evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0003, 0.9989)], at);
  assert.equal(sl.evaluation?.outcome, "sl");
  assert.equal(sl.evaluation?.r, -1);
  const expired = evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0004, 1.0001)], at);
  assert.equal(expired.evaluation?.outcome, "expired");
  assert.equal(expired.evaluation?.r, 0);
  assert.equal(evaluateSignalFromFrozenCandles(signal, [], at).reason, "missing_market_data");
  const geometryOnly = evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0004, 1.0001)], at);
  assert.notEqual(geometryOnly.evaluation?.outcome, "tp");
  const ambiguous = evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 0.9989)], at);
  assert.equal(ambiguous.reason, "ambiguous_same_candle");
  assert.equal(ambiguous.evaluation, null);
  assert.deepEqual(evaluateSignalFromFrozenCandles(signal, [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 1.0001)], at), tp);
  const short = fixtureSignal("short", { side: "sell", entryPrice: 1, stopLoss: 1.01, takeProfit: 0.98 });
  assert.equal(evaluateSignalFromFrozenCandles(short, [fixtureCandle("2026-07-30T12:01:00.000Z", 1, 1.001, 0.979)], at).evaluation?.outcome, "tp");
}

async function unresolvedStrategyFailsClosed() {
  const learning = new InMemoryLearningRepository({ lessons: [{ lessonId: "missing-strategy-lesson", schemaVersion: "fincoach.v2.learning-lesson.1", topic: "signal:not-a-strategy", attribution: { primaryCause: "tp", supportingCauses: [], positiveSamples: 1, negativeSamples: 0, averageR: 1 }, confidence: 0.7, evidenceJournalEntryIds: ["journal"], limitations: [], createdAt: now.toISOString(), supersedesLessonId: null, lineageEventIds: [causationId], correlationId, causationId }] });
  const lifecycle = new InMemoryStrategyLifecycleRepository();
  assert.equal(await createLifecycleDecisionsFromLessons({ repositories: { learning, lifecycle, strategies: { get: () => null } }, cycleId: "missing-strategy", correlationId, now, limit: 1 }), 0);
  assert.equal(lifecycle.list().length, 0);
}

async function evaluationCompletionRetriesAfterPartialFailure() {
  const signals = new InMemorySignalRepository();
  const evaluations = new InMemoryExternalEvaluationRepository();
  const forwardTesting = new InMemoryForwardTestingRepository();
  await signals.save(fixtureSignal("retry-completion"));
  await forwardTesting.save(fixtureForwardTest("retry-completion"));
  let attempts = 0;
  const completion = { complete: (...args: Parameters<InMemoryForwardTestingRepository["complete"]>) => { attempts += 1; if (attempts === 1) throw new Error("injected completion failure"); return forwardTesting.complete(...args); } };
  assert.equal(await createEvaluationsFromSignals({ repositories: { signals, evaluations, forwardTesting: completion }, marketData: { candlesForSignal: () => [fixtureCandle("2026-07-30T12:01:00.000Z", 1.0002, 1.0021, 1.0001)] }, cycleId: "retry-1", correlationId, now: new Date("2026-07-30T13:00:00.000Z"), limit: 1 }), 0);
  assert.equal(evaluations.listEvaluations().length, 1);
  assert.equal(forwardTesting.countActive(), 1);
  assert.equal(await createEvaluationsFromSignals({ repositories: { signals, evaluations, forwardTesting: completion }, marketData: { candlesForSignal: () => { throw new Error("must not refetch existing evaluation"); } }, cycleId: "retry-2", correlationId, now: new Date("2026-07-30T13:00:00.000Z"), limit: 1 }), 0);
  assert.equal(evaluations.listEvaluations().length, 1);
  assert.equal(forwardTesting.countActive(), 0);
}

async function resolvedStrategyIdOverridesLessonTopic() {
  const lesson = { lessonId: "lineage-identity", schemaVersion: "fincoach.v2.learning-lesson.1" as const, topic: "signal:signal-lineage-source", strategyId: "strategy-lineage-source", attribution: { primaryCause: "tp", supportingCauses: [], positiveSamples: 1, negativeSamples: 0, averageR: 1 }, confidence: 0.8, evidenceJournalEntryIds: ["journal-lineage-source"], limitations: [], createdAt: now.toISOString(), supersedesLessonId: null, lineageEventIds: ["strategy-lineage-source", "signal-lineage-source"], correlationId, causationId };
  const lifecycle = new InMemoryStrategyLifecycleRepository();
  assert.equal(await createLifecycleDecisionsFromLessons({ repositories: { learning: new InMemoryLearningRepository({ lessons: [lesson] }), lifecycle, strategies: { get: id => id === "strategy-lineage-source" ? { strategyId: id } as never : null } }, cycleId: "lineage-identity", correlationId, now, limit: 1 }), 1);
  assert.equal(lifecycle.list()[0].strategyId, "strategy-lineage-source");
  assert.notEqual(lifecycle.list()[0].strategyId, lesson.topic);
}

async function runTransition(
  forwardTesting: { eligibleForSignal(input: { now: Date; limit: number }): Promise<ForwardTestRecord[]> | ForwardTestRecord[] },
  signals: { save(signal: V2ResearchSignal): unknown; countActive?(at: Date): number | Promise<number>; listPage?(input?: { limit?: number; offset?: number }): { total: number } | Promise<{ total: number }> },
  options: { researchSignalEnabled?: boolean; maxActiveResearchSignals?: number; maxActiveForwardTests?: number } = {},
) {
  void options.maxActiveForwardTests;
  return await createSignalsFromForwardTests({
    repositories: { forwardTesting, signals },
    config: { researchSignalEnabled: options.researchSignalEnabled ?? true, maxActiveResearchSignals: options.maxActiveResearchSignals ?? options.maxActiveForwardTests ?? 3 },
    cycleId: "cycle-signal",
    correlationId,
    now,
  });
}

function fixtureForwardTest(label: string, overrides: Partial<ForwardTestRecord> = {}): ForwardTestRecord {
  return {
    forwardTestId: `forward-${label}`,
    schemaVersion: "fincoach.v2.forward-test.1",
    strategyId: `strategy-${label}`,
    strategyVersion: 1,
    courtCaseId: `court-${label}`,
    rankingId: `ranking-${label}`,
    status: "monitoring",
    demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: "2026-07-30T12:00:00.000Z" },
    snapshot: { snapshotId: `snapshot-${label}`, symbol: "EUR_USD", timestamp: "2026-07-30T12:00:00.000Z", bid: 1, ask: 1.0002, spread: 0.0002, fresh: true, contextEventId: causationId, lineageEventIds: [causationId] },
    ruleEvaluation: { entryConditions: 1, filters: 0 },
    reason: "fixture",
    counterargument: "fixture",
    expectedR: 1.5,
    risk: 0.001,
    createdAt: "2026-07-30T12:00:00.000Z",
    lineageEventIds: [causationId],
    correlationId,
    causationId,
    ...overrides,
  };
}

function fixtureSignal(label: string, overrides: Partial<V2ResearchSignal> = {}): V2ResearchSignal {
  return {
    schema: "fincoach.signal.v2",
    signalId: `signal-${label}`,
    symbol: "EUR_USD",
    side: "buy",
    entryPrice: 1.0002,
    stopLoss: 0.999,
    takeProfit: 1.002,
    timeframe: "1m",
    strategyId: `strategy-${label}`,
    strategyVersion: 1,
    courtCaseId: `court-${label}`,
    forwardTestId: `forward-${label}`,
    confidence: 0.8,
    evidenceScore: 0.8,
    validUntil: "2026-07-30T13:00:00.000Z",
    demoOnly: true,
    createdAt: "2026-07-30T12:00:00.000Z",
    lineageEventIds: [causationId, `forward-${label}`],
    correlationId,
    causationId,
    ...overrides,
  };
}

function fixtureCandle(timestamp: string, open: number, high: number, low: number): NormalizedCandle {
  return { symbol: "EUR_USD", timeframe: "1m", timestamp, open, high, low, close: open, spread: 0.0002, volume: 100, tickVolume: 100, complete: true, source: { provider: "frozen-fixture", providerSymbol: "EUR_USD", adapterVersion: "fixture-v1" }, corporateAction: null };
}

console.log("v2 signal transition tests passed");
