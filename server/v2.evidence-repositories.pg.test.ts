import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgForwardTestingRepository } from "./v2/forward-testing/pgRepository";
import { PgSignalRepository } from "./v2/signals/pgRepository";
import { PgExternalEvaluationRepository } from "./v2/external-evaluation/pgRepository";
import { PgResearchJournalRepository } from "./v2/journal/pgRepository";
import { PgLearningRepository } from "./v2/learning/pgRepository";
import { PgStrategyEvolutionRepository } from "./v2/strategy-evolution/pgRepository";
import { PgStrategyLifecycleRepository } from "./v2/strategy-lifecycle/pgRepository";
import { PgCourtroomRepository } from "./v2/courtroom/pgRepository";
import { PgRankingRepository } from "./v2/ranking/pgRepository";
import { V2OperationsService } from "./v2/operations/service";
import { V2PersistenceError } from "./v2/persistence/errors";

if (!process.env.DATABASE_URL) {
  console.log("v2 evidence repository PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `evidence-${Date.now()}-${randomUUID().slice(0, 8)}`;
const correlationId = randomUUID();
const now = new Date().toISOString();

try {
  await testEvidenceRepositories();
  await testMalformedUnsupportedAndOutage();
  console.log("v2 evidence repository PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function testEvidenceRepositories() {
  const forward = new PgForwardTestingRepository(pool);
  const signals = new PgSignalRepository(pool);
  const evaluations = new PgExternalEvaluationRepository(pool);
  const journal = new PgResearchJournalRepository(pool);
  const learning = new PgLearningRepository(pool);
  const evolution = new PgStrategyEvolutionRepository(pool);
  const lifecycle = new PgStrategyLifecycleRepository(pool);
  const courtroom = new PgCourtroomRepository(pool);
  const ranking = new PgRankingRepository(pool);

  const forwardRecord = {
    forwardTestId: `forward-${suffix}`,
    schemaVersion: "fincoach.v2.forward-test.1" as const,
    strategyId: `strategy-${suffix}`,
    strategyVersion: 1,
    courtCaseId: `court-${suffix}`,
    rankingId: `ranking-${suffix}`,
    status: "monitoring" as const,
    demoVerification: { demoOnly: true as const, environment: "paper" as const, accountMode: "paper" as const, verifiedAt: now },
    snapshot: { snapshotId: `snapshot-${suffix}`, symbol: "EUR_USD", timestamp: now, bid: 1, ask: 1.0002, spread: 0.0002, fresh: true, contextEventId: `context-${suffix}`, lineageEventIds: [`lineage-${suffix}`] },
    ruleEvaluation: { passed: true },
    reason: "fixture",
    counterargument: "fixture risk",
    expectedR: 1,
    risk: 0.5,
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  };
  const savedForward = await forward.save(forwardRecord);
  assert.equal(savedForward.inserted, true);
  assert.equal((await forward.get(forwardRecord.forwardTestId))?.strategyId, forwardRecord.strategyId);
  assert.equal((await forward.save(forwardRecord)).conflict, "idempotent");
  assert.equal((await forward.save({ ...forwardRecord, status: "failed" })).conflict, "conflicting");
  assert.equal((await new PgForwardTestingRepository(pool).get(forwardRecord.forwardTestId))?.forwardTestId, forwardRecord.forwardTestId);

  const signal = {
    schema: "fincoach.signal.v2" as const,
    signalId: `signal-${suffix}`,
    symbol: "EUR_USD",
    side: "buy" as const,
    entryPrice: 1,
    stopLoss: 0.99,
    takeProfit: 1.02,
    timeframe: "M15",
    strategyId: forwardRecord.strategyId,
    strategyVersion: 1,
    courtCaseId: forwardRecord.courtCaseId,
    forwardTestId: forwardRecord.forwardTestId,
    confidence: 0.8,
    evidenceScore: 0.7,
    validUntil: now,
    demoOnly: true as const,
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  };
  assert.equal((await signals.save(signal)).inserted, true);
  assert.equal((await signals.save(signal)).conflict, "idempotent");

  const evaluation = {
    evaluationId: `eval-${suffix}`,
    schemaVersion: "fincoach.v2.external-evaluation.1" as const,
    signalId: signal.signalId,
    evaluatorVersion: "fixture",
    entryReached: true,
    slReached: false,
    tpReached: true,
    outcome: "tp" as const,
    r: 1,
    profitLoss: 10,
    mfe: 1,
    mae: 0,
    holdingDurationMinutes: 15,
    dataSource: "fixture",
    evaluatedAt: now,
    notes: "fixture",
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  };
  assert.equal((await evaluations.saveEvaluation(evaluation)).inserted, true);

  const journalEntry = {
    journalEntryId: `journal-${suffix}`,
    schemaVersion: "fincoach.v2.research-journal.1" as const,
    subjectType: "signal" as const,
    subjectId: signal.signalId,
    sourceModule: "journal" as const,
    summary: "fixture",
    evidence: { signalId: signal.signalId },
    conclusion: "fixture",
    limitations: ["fixture"],
    supersedesEntryId: null,
    immutable: true as const,
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  };
  assert.equal((await journal.append(journalEntry)).inserted, true);

  const lesson = {
    lessonId: `lesson-${suffix}`,
    schemaVersion: "fincoach.v2.learning-lesson.1" as const,
    topic: "fixture",
    attribution: { primaryCause: "fixture", supportingCauses: [], positiveSamples: 1, negativeSamples: 0, averageR: 1 },
    confidence: 0.7,
    evidenceJournalEntryIds: [journalEntry.journalEntryId],
    limitations: [],
    createdAt: now,
    supersedesLessonId: null,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  };
  assert.equal((await learning.saveLesson(lesson)).inserted, true);
  assert.equal((await learning.saveProposal({
    proposalId: `learning-proposal-${suffix}`,
    schemaVersion: "fincoach.v2.revision-proposal.1",
    lessonId: lesson.lessonId,
    strategyId: forwardRecord.strategyId,
    boundedChange: { risk: "lower" },
    rationale: "fixture",
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  })).inserted, true);

  assert.equal((await evolution.save({
    proposalId: `evolution-${suffix}`,
    schemaVersion: "fincoach.v2.strategy-revision.1",
    parentStrategyId: forwardRecord.strategyId,
    parentStrategyVersion: 1,
    childStrategyId: `child-${suffix}`,
    mutations: [{ parameter: "risk", from: 1, to: 0.5, reason: "fixture" }],
    ruleChanges: [],
    status: "proposed",
    evidenceIds: [lesson.lessonId],
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  })).inserted, true);

  assert.equal((await lifecycle.save({
    decisionId: `decision-${suffix}`,
    schemaVersion: "fincoach.v2.strategy-lifecycle.1",
    strategyId: forwardRecord.strategyId,
    fromState: "candidate",
    toState: "paused",
    reason: "fixture",
    metrics: { expectancy: 0, drawdown: 0, calibration: 0, evidenceAgeDays: 0, regimeMismatch: 0, externalDisagreement: 0, edgeDecay: 0 },
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId,
    causationId: null,
  })).inserted, true);

  assert.equal((await courtroom.save({
    caseId: `court-${suffix}`,
    schemaVersion: "fincoach.v2.court.1",
    strategyId: forwardRecord.strategyId,
    strategyVersion: 1,
    hypothesisId: `hyp-${suffix}`,
    experimentIds: [`exp-${suffix}`],
    backtestIds: [`bt-${suffix}`],
    defenseExhibits: [],
    prosecutionExhibits: [],
    riskExhibits: [],
    policyVersion: "fixture",
    verdict: "watch",
    verdictReasons: ["fixture"],
    remediation: [],
    evidenceScore: 0.5,
    createdAt: now,
    correlationId,
    causationId: null,
    lineageEventIds: [`lineage-${suffix}`],
  })).inserted, true);

  assert.equal((await ranking.save({
    rankingId: `ranking-${suffix}`,
    schemaVersion: "fincoach.v2.ranking.1",
    policyVersion: "fixture",
    generatedAt: now,
    candidates: [],
    focusedPortfolio: { maxFocusedCount: 0, strategies: [], constraints: {} },
    demotions: [],
    retirements: [],
    evidenceGaps: [],
    correlationMatrixReference: "fixture",
    correlationId,
    causationId: null,
    lineageEventIds: [`lineage-${suffix}`],
  })).inserted, true);

  const operations = new V2OperationsService({ evidence: {
    "forward-tests": forward,
    signals,
    evaluations,
    journal,
    lessons: { listPage: input => learning.health().then(async () => ({ items: await learning.listLessons(input), total: (await learning.listLessons()).length })) },
    lifecycle,
    "court-cases": courtroom,
    strategies: ranking,
  } });
  assert.equal((await operations.listAsync("signals", { symbol: "EUR_USD", correlationId })).body.availability, "available");
  assert.equal((await operations.listAsync("forward-tests", { strategyId: forwardRecord.strategyId, correlationId })).body.items.length, 1);
}

async function testMalformedUnsupportedAndOutage() {
  await pool.query(
    `INSERT INTO v2_research_signals
      (record_id, schema_version, natural_key, idempotency_key, payload, lineage_event_ids, correlation_id, created_at)
     VALUES ($1, 'fincoach.signal.v2', $1, $1, $2, '[]'::jsonb, $3, $4)`,
    [`malformed-${suffix}`, JSON.stringify({ schema: "fincoach.signal.v2", signalId: "different" }), correlationId, now],
  );
  await assert.rejects(
    () => new PgSignalRepository(pool).get(`malformed-${suffix}`),
    error => error instanceof V2PersistenceError && error.code === "malformed_persisted_record",
  );
  await pool.query(
    `INSERT INTO v2_forward_tests
      (record_id, schema_version, natural_key, idempotency_key, payload, lineage_event_ids, correlation_id, created_at)
     VALUES ($1, 'fincoach.v2.forward-test.999', $1, $1, '{}'::jsonb, '[]'::jsonb, $2, $3)`,
    [`unsupported-${suffix}`, correlationId, now],
  );
  await assert.rejects(
    () => new PgForwardTestingRepository(pool).get(`unsupported-${suffix}`),
    error => error instanceof V2PersistenceError && error.code === "unsupported_schema_version",
  );
  const outage = new PgSignalRepository({
    query: async () => {
      const error = new Error("database unavailable") as Error & { code: string };
      error.code = "ECONNREFUSED";
      throw error;
    },
  });
  await assert.rejects(
    () => outage.get("anything"),
    error => error instanceof V2PersistenceError && error.code === "database_unavailable",
  );
}

async function cleanup() {
  const pattern = `%${suffix}%`;
  for (const table of [
    "v2_ranking_decisions",
    "v2_court_verdicts",
    "v2_strategy_lifecycle_decisions",
    "v2_strategy_revision_proposals",
    "v2_learning_revision_proposals",
    "v2_learning_lessons",
    "v2_research_journal_entries",
    "v2_external_evaluations",
    "v2_research_signals",
    "v2_forward_tests",
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE record_id LIKE $1 OR natural_key LIKE $1 OR idempotency_key LIKE $1`, [pattern]);
  }
}
