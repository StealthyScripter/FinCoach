import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
import { loadV2RuntimeConfig } from "./v2/runtime/config";
import { ObservationsV2Service, evidence, semanticObservationKey } from "./v2/observations";
import { HypothesisV2EventTypes, HypothesisV2Service } from "./v2/hypothesis";
import { registerV2OperationsRoutes, V2OperationsService } from "./v2/operations";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { TelegramReportingService } from "./telegram/reportingService";
import { InMemoryTelegramRepository } from "./telegram/repository";

{
  const validation = loadV2RuntimeConfig({
    FINCOACH_V2_OBSERVATION_TIMEFRAMES: "1hr,1day,1week,3h,6h",
    FINCOACH_V2_MIN_INDEPENDENT_HYPOTHESIS_OCCURRENCES: "1",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(validation.config.timeframes, ["1h", "1d", "1w", "3h", "6h"]);
  assert.equal(validation.config.minIndependentHypothesisOccurrences, 2);
  assert.equal(validation.config.liveExecutionEnabled, false);
}

{
  const sourceEventId = randomUUID();
  const eur = evidence("chart", sourceEventId, "volatility.compression", true, "2026-07-30T12:00:00.000Z", { symbol: "EUR_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "2026-07-30T11:45:00.000Z", candleEnd: "2026-07-30T12:00:00.000Z", sourceDataHash: "hash-a" });
  const gbp = evidence("chart", sourceEventId, "volatility.compression", true, "2026-07-30T12:00:00.000Z", { symbol: "GBP_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "2026-07-30T11:45:00.000Z", candleEnd: "2026-07-30T12:00:00.000Z", sourceDataHash: "hash-a" });
  const nextCandle = evidence("chart", sourceEventId, "volatility.compression", true, "2026-07-30T12:15:00.000Z", { symbol: "EUR_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "2026-07-30T12:00:00.000Z", candleEnd: "2026-07-30T12:15:00.000Z", sourceDataHash: "hash-b" });
  assert.notEqual(eur.evidenceId, gbp.evidenceId);
  assert.notEqual(eur.evidenceId, nextCandle.evidenceId);
  assert.equal(eur.evidenceId, evidence("chart", sourceEventId, "volatility.compression", true, "2026-07-30T12:00:00.000Z", { symbol: "EUR_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "2026-07-30T11:45:00.000Z", candleEnd: "2026-07-30T12:00:00.000Z", sourceDataHash: "hash-a" }).evidenceId);
  assert.notEqual(
    semanticObservationKey({ symbol: "EUR_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "a", candleEnd: "b", sourceDataHash: "hash-a" }),
    semanticObservationKey({ symbol: "EUR_USD", timeframe: "15m", detectorId: "volatility-compression", detectorVersion: "v1", observationType: "volatility_compression", candleStart: "b", candleEnd: "c", sourceDataHash: "hash-b" }),
  );
}

{
  const service = new ObservationsV2Service();
  const strong = service.create(observationInput("EUR_USD", "15m", "2026-07-30T12:00:00.000Z", { compressionRatio: 0.2, breakoutDistance: 0.002, sampleSize: 80, spread: 0.0001 }));
  const weak = service.create(observationInput("EUR_USD", "15m", "2026-07-30T12:15:00.000Z", { compressionRatio: 0.95, breakoutDistance: 0.00001, sampleSize: 10, spread: 0.004 }));
  assert.notEqual(strong.observations[0].confidence, weak.observations[0].confidence);
  assert.notEqual(strong.observations[0].qualityScore, weak.observations[0].qualityScore);
  assert.ok(strong.observations[0].scoreComponents);
  assert.ok(strong.observations[0].naturalKey);
}

{
  const hypotheses = new HypothesisV2Service();
  const base = hypothesisInput(["obs-a"], ["evidence-a"]);
  assert.equal(hypotheses.generate(base).events[0].eventType, HypothesisV2EventTypes.HypothesisInsufficientEvidence);
  const created = hypotheses.generate(hypothesisInput(["obs-a", "obs-b"], ["evidence-a", "evidence-b"]));
  assert.equal(created.hypothesis?.status, "ready_for_rules");
  assert.deepEqual(created.hypothesis?.sourceTraderAnalysisIds, []);
}

{
  const operations = new V2OperationsService({ operations: {
    async latestReport() { return null; },
    async getReportByDate() { return null; },
    async saveReport(record) { return { inserted: true, record }; },
    async saveDelivery(record) { return { inserted: true, record }; },
    async researchProgress() {
      return {
        schemaVersion: "fincoach.v2.research-progress.1",
        generatedAt: "2026-07-30T12:00:00.000Z",
        runtime: { latestCompletedCycle: null },
        windows: { currentHour: { observations: 2 }, running24Hours: { observations: 2 }, running7Days: { observations: 2 }, total: { observations: 2 } },
        coverage: { symbols: [{ value: "EUR_USD", count: 2 }], timeframes: [{ value: "15m", count: 2 }], detectors: [{ value: "breakout", count: 2 }], strategyFamilies: [{ value: "compression_breakout", count: 2 }], mostRecentMarketDataTimestamp: "2026-07-30T12:00:00.000Z" },
        pipeline: { observations: 2, hypotheses: 1, strategies: 1, experiments: 1, backtests: 1, verdicts: 1, rankedCandidates: 1, forwardTests: 0, signals: 0, evaluations: 0, journalEntries: 0, lessons: 0, lifecycleDecisions: 0, pilotScorecards: 0, detectorEvaluations: { attemptedCurrentHour: 2, completedCurrentHour: 2, duplicatesSuppressedCurrentHour: 0, failuresCurrentHour: 0 } },
        readiness: { currentStage: "ranked candidate", nextStage: "forward-test eligible", liveExecutionBlocked: true, paperExecutionState: "disabled", demoExecutionState: "demo_only_gated" },
      };
    },
    async researchBlockers() {
      return { schemaVersion: "fincoach.v2.research-blockers.1", generatedAt: "2026-07-30T12:00:00.000Z", highestSeverity: "info", blockers: [{ code: "live_execution_blocked", severity: "info", phase: "safety", reason: "Live execution remains blocked by design.", currentValue: true, requiredValue: true, recommendedAction: "Keep live disabled.", firstObservedAt: "2026-07-30T12:00:00.000Z", lastObservedAt: "2026-07-30T12:00:00.000Z" }] };
    },
  } });
  const progress = await operations.researchProgress();
  assert.equal(progress.body.liveExecutionBlocked, true);
  assert.equal((progress.body.pipeline as Record<string, unknown>).hypotheses, 1);
  const blockers = await operations.researchBlockers();
  assert.equal(blockers.body.highestSeverity, "info");
  const app = { routes: [] as string[], get(path: string) { this.routes.push(path); } };
  registerV2OperationsRoutes(app as never, operations);
  assert.ok(app.routes.includes("/api/v2/research/progress"));
  assert.ok(app.routes.includes("/api/v2/research/blockers"));
}

{
  const router = new TelegramCommandRouter(
    { TELEGRAM_ALLOWED_USER_ID: "operator" } as NodeJS.ProcessEnv,
    new TelegramReportingService(new InMemoryTelegramRepository()),
    new InMemoryTelegramRepository(),
  );
  assert.match(await router.handle({ command: "/research_progress", actorId: "operator", chatId: "chat" }), /FinCoach Research Progress/);
  assert.match(await router.handle({ command: "/research_blockers", actorId: "operator", chatId: "chat" }), /FinCoach Research Blockers/);
  assert.match(await router.handle({ command: "/research_progress", actorId: "intruder", chatId: "chat" }), /unauthorized/);
}

{
  const runtime = createFinCoachV2Runtime({
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "true",
    FINCOACH_V2_CADENCE_MS: "60000",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  (runtime as unknown as { repositories: unknown }).repositories = minimalRepositories();
  const first = await runtime.start();
  const second = await runtime.start();
  assert.equal(first.memory.activeTimers, 0);
  assert.equal(second.memory.activeTimers <= 1, true);
  await runtime.stop("test");
}

{
  const saved = {
    observations: [] as Record<string, unknown>[],
    hypotheses: [] as Record<string, unknown>[],
    strategies: [] as Record<string, unknown>[],
    experiments: [] as Record<string, unknown>[],
    backtests: [] as Record<string, unknown>[],
    court: [] as Record<string, unknown>[],
    rankings: [] as Record<string, unknown>[],
  };
  const runtime = createFinCoachV2Runtime({
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "false",
    FINCOACH_V2_OBSERVATION_SYMBOLS: "EUR_USD",
    FINCOACH_V2_OBSERVATION_TIMEFRAMES: "15m",
    FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: "1",
    FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE: "1",
    FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE: "1",
    FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE: "1",
    FINCOACH_V2_CYCLE_TIMEOUT_MS: "120000",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  (runtime as unknown as { repositories: unknown }).repositories = e2eRepositories(saved);
  const result = await runtime.runOnce({ requestedBy: "synthetic-dry-run" }) as Record<string, unknown>;
  assert.equal(result.completed, true);
  assert.equal(result.liveExecutionBlocked, true);
  assert.equal(saved.observations.length, 1);
  assert.equal(saved.hypotheses.length, 1);
  assert.equal(saved.strategies.length, 1);
  assert.equal(saved.experiments.length, 1);
  assert.equal(saved.backtests.length, 1);
  assert.equal(saved.court.length, 1);
  assert.equal(saved.rankings.length, 1);
}

function observationInput(symbol: string, timeframe: string, observedAt: string, metrics: Record<string, number>) {
  const sourceEventId = randomUUID();
  return {
    symbol,
    timeframe,
    observedAt,
    candleStart: observedAt,
    candleEnd: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
    lookbackStart: new Date(Date.parse(observedAt) - 80 * 15 * 60_000).toISOString(),
    lookbackEnd: observedAt,
    marketDataSource: "fixture",
    sourceDataIds: [`fixture:${symbol}:${timeframe}:${observedAt}`],
    sourceDataHash: `hash:${symbol}:${timeframe}:${observedAt}`,
    metrics,
    contextEventId: sourceEventId,
    upstreamEventIds: [sourceEventId],
    correlationId: randomUUID(),
    causationId: sourceEventId,
    evidence: [
      evidence("chart", sourceEventId, "volatility.compression", true, observedAt, { symbol, timeframe, sourceDataHash: `hash:${symbol}:${timeframe}:${observedAt}` }),
      evidence("chart", sourceEventId, "structure.breakOfStructure", true, observedAt, { symbol, timeframe, sourceDataHash: `hash:${symbol}:${timeframe}:${observedAt}` }),
    ],
  };
}

function hypothesisInput(sourceObservationIds: string[], evidenceEventIds: string[]) {
  return {
    statement: "Independent compression observations may precede continuation.",
    targetPopulation: { symbols: ["EUR_USD"], assetClasses: ["forex"], timeframes: ["15m"], sessions: ["all"], regimes: ["demo"] },
    conditions: [{ field: "observationType", operator: "==" as const, value: "volatility_compression" }],
    expectedOutcome: { metric: "expectancy" as const, operator: ">" as const, value: 0, horizon: "next_bar" },
    baseline: { baselineId: "zero", description: "zero edge", metric: "expectancy", value: 0 },
    invalidationCriteria: [{ field: "costSensitivity", operator: ">" as const, value: 0.5 }],
    minimumSampleSize: 30,
    minimumIndependentOccurrences: 2,
    mechanism: "fixture",
    evidenceEventIds,
    contradictoryEvidenceEventIds: [],
    sourceObservationIds,
    sourceTraderAnalysisIds: [],
    correlationId: randomUUID(),
    causationId: randomUUID(),
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}

function minimalRepositories() {
  const saved: Record<string, unknown[]> = { cycles: [] };
  const save = async (record: unknown) => ({ inserted: true, record });
  return {
    orchestration: {
      acquireLease: async () => ({ leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 }),
      saveCycle: async (record: unknown) => { saved.cycles.push(record); return { inserted: saved.cycles.length === 1, record }; },
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => undefined,
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: { save, list: async () => [], eligibleForHypothesis: async () => [], eligibleSemanticGroups: async () => [] },
    hypotheses: { save },
    strategies: { save },
    experiments: { save },
    backtests: { save },
    courtroom: { save },
    ranking: { save },
    operations: { saveDetectorEvaluation: async () => undefined },
    pilot: {},
    forwardTesting: {},
    signals: {},
    evaluations: {},
    journal: {},
    learning: {},
    lifecycle: {},
    evolution: {},
    evidence: {},
  };
}

function e2eRepositories(saved: {
  observations: Record<string, unknown>[];
  hypotheses: Record<string, unknown>[];
  strategies: Record<string, unknown>[];
  experiments: Record<string, unknown>[];
  backtests: Record<string, unknown>[];
  court: Record<string, unknown>[];
  rankings: Record<string, unknown>[];
}) {
  let cycleCount = 0;
  const saveTo = (collection: Record<string, unknown>[]) => async (record: Record<string, unknown>) => {
    collection.push(record);
    return { inserted: true, record };
  };
  return {
    orchestration: {
      acquireLease: async () => ({ leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 }),
      saveCycle: async (record: unknown) => ({ inserted: ++cycleCount === 1, record }),
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => undefined,
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations: {
      save: saveTo(saved.observations),
      eligibleSemanticGroups: async () => {
        const current = saved.observations[0] as import("./v2/observations").MarketObservation | undefined;
        return current ? [{ symbol: current.symbol, timeframe: current.timeframe, detectorId: current.detectorId, observationType: current.observationType, strategyFamily: current.strategyFamily }] : [];
      },
      eligibleForHypothesis: async (input: { now: Date }) => {
        const current = saved.observations[0] as import("./v2/observations").MarketObservation;
        const prior = {
          ...current,
          observationId: `${current.observationId}-prior`,
          observedAt: new Date(Date.parse(current.observedAt) - 15 * 60_000).toISOString(),
          candleStart: new Date(Date.parse(current.candleStart!) - 15 * 60_000).toISOString(),
          candleEnd: new Date(Date.parse(current.candleEnd!) - 15 * 60_000).toISOString(),
          expiresAt: new Date(input.now.getTime() + 60 * 60_000).toISOString(),
          sourceDataHash: `${current.sourceDataHash}:prior`,
          evidence: current.evidence.map(item => ({ ...item, evidenceId: `${item.evidenceId}:prior` })),
        };
        return [current, prior];
      },
    },
    hypotheses: { save: saveTo(saved.hypotheses) },
    strategies: { save: saveTo(saved.strategies) },
    experiments: { save: saveTo(saved.experiments) },
    backtests: { save: saveTo(saved.backtests) },
    courtroom: { save: saveTo(saved.court) },
    ranking: { save: saveTo(saved.rankings) },
    operations: { saveDetectorEvaluation: async () => undefined },
    pilot: {},
    forwardTesting: {},
    signals: {},
    evaluations: {},
    journal: {},
    learning: {},
    lifecycle: {},
    evolution: {},
    evidence: {},
  };
}

console.log("v2 research pipeline repair tests passed");
