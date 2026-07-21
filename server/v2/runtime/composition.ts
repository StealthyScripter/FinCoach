import { createHash, randomUUID } from "crypto";
import { Pool } from "pg";
import { configureV2OperationsService, V2OperationsService } from "../operations/service";
import type { V2ModuleAvailabilityDetail, V2OperationsCollection } from "../operations/contracts";
import { PgV2OperationsRepository } from "../operations/pgRepository";
import { PgOrchestrationRepository } from "../orchestration/pgRepository";
import { PgDemoResearchPilotRepository } from "../pilot/pgRepository";
import { PgCourtroomRepository } from "../courtroom/pgRepository";
import { PgRankingRepository } from "../ranking/pgRepository";
import { PgForwardTestingRepository } from "../forward-testing/pgRepository";
import { PgSignalRepository } from "../signals/pgRepository";
import { PgExternalEvaluationRepository } from "../external-evaluation/pgRepository";
import { PgResearchJournalRepository } from "../journal/pgRepository";
import { PgLearningRepository } from "../learning/pgRepository";
import { PgStrategyLifecycleRepository } from "../strategy-lifecycle/pgRepository";
import { PgStrategyEvolutionRepository } from "../strategy-evolution/pgRepository";
import { PgObservationRepository } from "../observations/pgRepository";
import { PgHypothesisRepository } from "../hypothesis/pgRepository";
import { PgExperimentRepository } from "../experiments/pgRepository";
import { PgBacktestRepository } from "../backtesting/pgRepository";
import { PgStrategyDefinitionRepository } from "../rules/pgRepository";
import type { OrchestrationErrorCode } from "../orchestration/contracts";
import { ObservationsV2Service, evidence as observationEvidence } from "../observations";
import { HypothesisV2Service } from "../hypothesis";
import { rulesV2Compiler } from "../rules";
import { ExperimentsV2Service } from "../experiments";
import { backtestingV2Engine, type BacktestResult } from "../backtesting";
import { CourtroomV2Service } from "../courtroom";
import { RankingV2Service, type RankingCandidateInput } from "../ranking";
import type { NormalizedCandle, V2Timeframe } from "../market-data";
import { v2TelemetryService } from "../telemetry";
import { loadV2RuntimeConfig, type V2RuntimeConfig, type V2RuntimeConfigValidation } from "./config";
import { memorySnapshot } from "./memory";
import { PgV2RuntimeRepository } from "./repository";
import { eventLogService } from "../../eventLogService";
import { structuredLogger } from "../../structuredLogger";
import { createDomainEvent, type DomainEvent } from "../contracts";
import { OrchestrationV2EventTypes } from "../orchestration/events";

type V2Repositories = ReturnType<typeof createRepositories>;

export type V2RuntimeState = "disabled" | "initialized" | "running" | "idle" | "blocked" | "failed" | "stopping" | "stopped";

export class FinCoachV2Runtime {
  private pool: Pool | null = null;
  private repositories: V2Repositories | null = null;
  private timer: NodeJS.Timeout | null = null;
  private bootId = randomUUID();
  private state: V2RuntimeState = "disabled";
  private lastRunAt: string | null = null;
  private lastRunResult: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private nextScheduledCycleAt: string | null = null;
  private activeCycle = false;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly configValidation: V2RuntimeConfigValidation = loadV2RuntimeConfig(env),
  ) {}

  get config() {
    return this.configValidation.config;
  }

  async initialize() {
    const validation = this.configValidation;
    if (!validation.ok) {
      this.state = validation.config.runtimeEnabled ? "blocked" : "disabled";
      configureV2OperationsService(this.createOperationsService(null));
      structuredLogger.v2({
        level: validation.config.runtimeEnabled ? "error" : "info",
        event: "v2_runtime_configuration_checked",
        message: validation.config.runtimeEnabled ? "V2 runtime configuration failed" : "V2 runtime disabled by configuration",
        runtimeInstanceId: this.bootId,
        configuration: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, config: redactedConfig(validation.config) },
      });
      if (validation.config.runtimeEnabled) throw new Error(`V2 runtime configuration failed: ${validation.errors.join("; ")}`);
      return this.status();
    }
    if (!validation.config.runtimeEnabled) {
      this.state = "disabled";
      configureV2OperationsService(this.createOperationsService(null));
      structuredLogger.v2({ level: "info", event: "v2_runtime_disabled", message: "V2 runtime disabled by configuration", runtimeInstanceId: this.bootId, configuration: { config: redactedConfig(validation.config), warnings: validation.warnings } });
      return this.status();
    }
    structuredLogger.v2({ level: "info", event: "v2_runtime_initializing", message: "V2 runtime initialization started", runtimeInstanceId: this.bootId, configuration: { config: redactedConfig(validation.config), warnings: validation.warnings } });
    this.pool = new Pool({ connectionString: this.env.DATABASE_URL });
    this.repositories = createRepositories(this.pool);
    await this.verifyDatabase();
    await this.recordBoot();
    configureV2OperationsService(this.createOperationsService(this.repositories));
    this.state = "initialized";
    structuredLogger.v2({ level: "info", event: "v2_runtime_initialized", message: "V2 runtime initialized", runtimeInstanceId: this.bootId });
    return this.status();
  }

  async start() {
    if (!this.config.runtimeEnabled) return this.status();
    if (!this.repositories) await this.initialize();
    if (!this.config.autostart) {
      this.state = "idle";
      structuredLogger.v2({ level: "info", event: "v2_runtime_idle", message: "V2 runtime initialized without autostart", runtimeInstanceId: this.bootId });
      return this.status();
    }
    if (this.timer) return this.status();
    this.state = "running";
    const schedule = () => {
      this.nextScheduledCycleAt = new Date(Date.now() + this.config.cadenceMs).toISOString();
      structuredLogger.v2({ level: "info", event: "v2_cycle_scheduled", message: "Next V2 research cycle scheduled", runtimeInstanceId: this.bootId, nextScheduledCycleAt: this.nextScheduledCycleAt, cadenceMs: this.config.cadenceMs });
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runOnce({ requestedBy: "v2-autostart" }).finally(schedule);
      }, this.config.cadenceMs);
      this.timer.unref();
    };
    void this.runOnce({ requestedBy: "v2-autostart-initial" }).finally(schedule);
    return this.status();
  }

  async stop(reason = "runtime_stop") {
    structuredLogger.v2({ level: "info", event: "v2_runtime_stopping", message: "V2 runtime stopping", runtimeInstanceId: this.bootId, reason });
    this.state = "stopping";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextScheduledCycleAt = null;
    await this.pool?.end().catch(() => undefined);
    this.state = "stopped";
    this.lastRunResult = { stopped: true, reason };
    structuredLogger.v2({ level: "info", event: "v2_runtime_stopped", message: "V2 runtime stopped", runtimeInstanceId: this.bootId, reason });
    return this.status();
  }

  async resume() {
    if (!this.config.runtimeEnabled) return this.status();
    if (!this.repositories) await this.initialize();
    this.state = this.config.autostart ? "running" : "idle";
    return this.status();
  }

  async runOnce(input: { requestedBy?: string } = {}) {
    if (!this.config.runtimeEnabled || !this.config.researchEnabled || !this.config.pilotEnabled) {
      this.state = this.config.runtimeEnabled ? "blocked" : "disabled";
      this.lastError = blockedReason(this.config);
      this.lastRunResult = { completed: false, reason: this.lastError };
      structuredLogger.v2({
        level: "warn",
        event: "research_cycle_blocked",
        message: "V2 research cycle blocked by configuration",
        runtimeInstanceId: this.bootId,
        requestedBy: input.requestedBy ?? "manual",
        reason: this.lastError,
      });
      return this.lastRunResult;
    }
    if (!this.repositories) await this.initialize();
    const repositories = this.requireRepositories();
    if (this.activeCycle) {
      structuredLogger.v2({ level: "warn", event: "research_cycle_suppressed", message: "V2 research cycle suppressed because one is already active", runtimeInstanceId: this.bootId, requestedBy: input.requestedBy ?? "manual" });
      return { completed: false, reason: "cycle_already_active" };
    }
    const correlationId = randomUUID();
    const workerId = `v2-runtime-${process.pid}-${this.bootId}`;
    const startedAt = Date.now();
    const lease = await repositories.orchestration.acquireLease({ leaseName: "fincoach-v2-runtime", workerId, now: new Date(), ttlMs: this.config.leaseTtlMs, correlationId });
    if (!lease) {
      this.state = "blocked";
      this.lastError = "runtime_lease_unavailable";
      this.lastRunResult = { completed: false, reason: this.lastError };
      structuredLogger.v2({ level: "warn", event: "research_cycle_blocked", message: "V2 research cycle could not acquire runtime lease", correlationId, runtimeInstanceId: this.bootId, requestedBy: input.requestedBy ?? "manual", reason: this.lastError });
      return this.lastRunResult;
    }
    this.activeCycle = true;
    const now = new Date();
    const cycleId = `cycle-${now.toISOString()}-${randomUUID().slice(0, 8)}`;
    structuredLogger.v2({ level: "info", event: "research_cycle_started", message: "V2 research cycle started", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, workerId, leaseName: lease.leaseName });
    await repositories.orchestration.saveCycle({ cycleId, status: "requested", requestedBy: input.requestedBy ?? "manual", idempotencyKey: cycleId, correlationId, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const cycleRequested = createDomainEvent({ eventType: OrchestrationV2EventTypes.ResearchCycleRequested, sourceModule: "orchestration", correlationId, causationId: null, payload: { cycleId, requestedBy: input.requestedBy ?? "manual" } });
    await repositories.orchestration.updateCycleStatus({ cycleId, status: "running" });
    try {
      const result = await this.runResearchPath({ cycleId, cycleEventId: cycleRequested.eventId, correlationId, now });
      await repositories.orchestration.updateCycleStatus({ cycleId, status: "completed" });
      await repositories.orchestration.checkpoint({ consumerId: "v2-runtime-cycle", sourceEventId: cycleId, idempotencyKey: cycleId, checkpointedAt: new Date().toISOString(), attempt: 1, correlationId });
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      this.lastRunResult = { ...result, cycleId, completed: true };
      this.state = this.config.autostart ? "running" : "idle";
      structuredLogger.v2({ level: "info", event: "research_cycle_completed", message: "V2 research cycle completed", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, durationMs: Date.now() - startedAt, result });
      return this.lastRunResult;
    } catch (error) {
      await repositories.orchestration.updateCycleStatus({ cycleId, status: "failed" }).catch(() => undefined);
      const nextRetryAt = null;
      await repositories.orchestration.saveRetry({ sourceEventId: cycleId, consumerId: "v2-runtime-cycle", idempotencyKey: `${cycleId}:retry`, attempt: 1, maxAttempts: this.config.retryBudget, exhausted: this.config.retryBudget <= 1, nextRetryAt, lastErrorCode: classifyRuntimeErrorCode(error), correlationId, causationId: null });
      this.lastError = error instanceof Error ? error.message : "unknown";
      this.lastRunResult = { cycleId, completed: false, reason: this.lastError };
      this.state = "failed";
      structuredLogger.v2Error({ level: "error", event: "research_cycle_failed", message: "Research cycle failed", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, durationMs: Date.now() - startedAt, retryAttempt: 1, nextRetryAt, error });
      return this.lastRunResult;
    } finally {
      this.activeCycle = false;
      await repositories.orchestration.releaseLease({ leaseName: lease.leaseName, workerId: lease.workerId, fencingToken: lease.fencingToken, now: new Date() }).catch(() => undefined);
    }
  }

  status() {
    const memory = memorySnapshot({ eventLogItems: eventLogService.snapshot().eventCount, activeCycles: this.activeCycle ? 1 : 0, activeTimers: this.timer ? 1 : 0 });
    return {
      schemaVersion: "fincoach.v2.runtime-status.1",
      bootId: this.bootId,
      state: this.state,
      config: redactedConfig(this.config),
      configuration: { ok: this.configValidation.ok, errors: this.configValidation.errors, warnings: this.configValidation.warnings },
      lastRunAt: this.lastRunAt,
      lastRunResult: this.lastRunResult,
      lastError: this.lastError,
      nextScheduledCycleAt: this.nextScheduledCycleAt,
      liveMoneyExecution: this.config.liveExecutionEnabled ? "enabled_blocked_by_policy" : "blocked",
      demoBrokerExecution: this.config.demoBrokerExecutionEnabled ? "enabled_demo_only" : "disabled",
      paperExecution: this.config.paperExecutionEnabled ? "enabled" : "disabled",
      researchSignalCreation: this.config.researchSignalEnabled ? "enabled" : "disabled",
      telegramPublication: this.config.telegramSignalPublicationEnabled ? "enabled" : "disabled",
      memory,
    };
  }

  operationsService() {
    return this.createOperationsService(this.repositories);
  }

  private createOperationsService(repositories: V2Repositories | null) {
    const details = moduleDetails(this.config, repositories);
    return new V2OperationsService(repositories ? {
      operations: repositories.operations,
      orchestration: repositories.orchestration,
      pilot: repositories.pilot,
      evidence: repositories.evidence,
    } : undefined, details, () => ({
      runtimeState: this.state,
      researchState: this.config.researchEnabled ? (this.config.pilotEnabled ? "idle" : "blocked") : "disabled",
      pilotState: this.config.pilotEnabled ? "configured" : null,
      paperExecutionState: this.config.paperExecutionEnabled ? "enabled" : "disabled",
      demoBrokerState: this.config.demoBrokerExecutionEnabled ? "enabled_demo_only" : "disabled",
      telegramPublicationState: this.config.telegramSignalPublicationEnabled ? "enabled" : "disabled",
      configurationState: this.configValidation.ok ? "complete" : "incomplete",
      economicEvidenceState: "available_empty",
      providerHealth: this.config.researchEnabled ? "available" : "disabled",
    }));
  }

  private requireRepositories() {
    if (!this.repositories) throw new Error("V2 repositories are not initialized");
    return this.repositories;
  }

  private async verifyDatabase() {
    await this.repositories?.runtime.health();
  }

  private async recordBoot() {
    await this.repositories?.runtime.recordBoot({
      bootId: this.bootId,
      runtimeEnabled: this.config.runtimeEnabled,
      researchEnabled: this.config.researchEnabled,
      liveExecutionEnabled: this.config.liveExecutionEnabled,
      heapLimitBytes: memorySnapshot().heapLimitBytes,
      payload: { pid: process.pid },
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
  }

  private async runResearchPath(input: { cycleId: string; cycleEventId: string; correlationId: string; now: Date }) {
    const repositories = this.requireRepositories();
    const observations = new ObservationsV2Service();
    const hypotheses = new HypothesisV2Service();
    const experiments = new ExperimentsV2Service();
    const courtroom = new CourtroomV2Service();
    const ranking = new RankingV2Service();
    let observationsCount = 0;
    let hypothesesCount = 0;
    let strategiesCount = 0;
    let experimentsCount = 0;
    let backtestsCount = 0;
    let verdictsCount = 0;
    let rankedCount = 0;
    const rankingCandidates: RankingCandidateInput[] = [];

    for (const symbol of this.config.symbols.slice(0, this.config.maxObservationsPerCycle)) {
      const timeframe = normalizeTimeframe(this.config.timeframes[0]);
      const candles = demoCandles(symbol, timeframe, input.now, 80);
      const contextEventId = input.cycleEventId;
      const obs = observations.create({
        symbol,
        timeframe,
        observedAt: input.now.toISOString(),
        contextEventId,
        upstreamEventIds: [input.cycleEventId],
        correlationId: input.correlationId,
        causationId: input.cycleEventId,
        evidence: [
          observationEvidence("chart", contextEventId, "volatility.compression", true, input.now.toISOString()),
          observationEvidence("chart", contextEventId, "structure.breakOfStructure", true, input.now.toISOString()),
        ],
      });
      for (const observation of obs.observations.slice(0, this.config.maxObservationsPerCycle - observationsCount)) {
        const observationEventId = firstEventId(obs.events, "observations", observation.observationId);
        await repositories.observations.save(observation);
        observationsCount += 1;
        const hypothesis = hypotheses.generate({
          statement: `${symbol} ${timeframe} breakout after compression may have positive expectancy after costs.`,
          targetPopulation: { symbols: [symbol], assetClasses: ["forex"], timeframes: [timeframe], sessions: ["all"], regimes: ["demo"] },
          conditions: [{ field: "observationType", operator: "in", value: ["breakout", "volatility_compression"] }],
          expectedOutcome: { metric: "expectancy", operator: ">", value: 0, horizon: "next_bar" },
          baseline: { baselineId: "zero-edge", description: "No edge after costs", metric: "expectancy", value: 0 },
          invalidationCriteria: [{ field: "costSensitivity", operator: ">", value: 0.5 }],
          minimumSampleSize: 30,
          minimumIndependentOccurrences: 2,
          mechanism: "Compression can precede directional expansion, but this remains unproven until backtested.",
          evidenceEventIds: [observation.observationId],
          contradictoryEvidenceEventIds: [],
          sourceObservationIds: [observation.observationId],
          sourceTraderAnalysisIds: [],
          correlationId: input.correlationId,
          causationId: observationEventId,
          createdAt: input.now.toISOString(),
        });
        if (!hypothesis.hypothesis) continue;
        const hypothesisEventId = firstEventId(hypothesis.events, "hypothesis", hypothesis.hypothesis.hypothesisId);
        await repositories.hypotheses.save(hypothesis.hypothesis);
        hypothesesCount += 1;
        if (hypothesesCount > this.config.maxHypothesesPerCycle) break;
        const compiled = rulesV2Compiler.compile({
          hypothesisId: hypothesis.hypothesis.hypothesisId,
          name: `V2 demo ${symbol} compression breakout`,
          assetClasses: ["forex"],
          symbols: [symbol],
          timeframes: [timeframe],
          entryConditions: [{ field: "observationType", operator: "in", value: ["breakout"] }],
          filters: [],
          sidePolicy: { candidateSide: "buy" },
          stopLoss: { type: "atr_multiple", value: 1.5 },
          takeProfit: { type: "atr_multiple", value: 2 },
          timeExit: { type: "time", value: "1h" },
          invalidationRules: [{ field: "spread", operator: "<", value: 0.01 }],
          positionSizing: { type: "fixed_fractional", riskFraction: 0.001 },
          costModel: { costModelId: "deterministic-demo-costs", version: "v1" },
          sessionRestrictions: [],
          eventRestrictions: [],
          supportedRegimes: ["demo"],
          requiredFeatureDefinitions: [],
          correlationId: input.correlationId,
          causationId: hypothesisEventId,
          createdAt: input.now.toISOString(),
        });
        if (!compiled.strategy) continue;
        const strategyEventId = firstEventId(compiled.events, "rules", compiled.strategy.strategyId);
        await repositories.strategies.save(compiled.strategy);
        strategiesCount += 1;
        const experiment = experiments.create({
          hypothesisId: hypothesis.hypothesis.hypothesisId,
          strategyId: compiled.strategy.strategyId,
          strategyVersion: compiled.strategy.strategyVersion,
          experimentType: "baseline_backtest",
          datasetSpecification: { symbols: [symbol], timeframes: [timeframe], start: candles[0].timestamp, end: candles[candles.length - 1].timestamp },
          parameterSpecification: {},
          holdoutPolicy: { trainEnd: candles[40].timestamp, validationEnd: candles[60].timestamp, testStart: new Date(Date.parse(candles[candles.length - 1].timestamp) + 60_000).toISOString(), finalHoldoutLocked: true },
          randomSeed: "deterministic-demo-seed",
          resourceBudget: { maxCandles: candles.length, maxRuntimeMs: this.config.cycleTimeoutMs },
          priority: 1,
          maxAttempts: this.config.retryBudget,
          correlationId: input.correlationId,
          causationId: strategyEventId,
          createdAt: input.now.toISOString(),
        });
        const experimentEventId = firstEventId(experiment.events, "experiments", experiment.experiment.experimentId);
        await repositories.experiments.save(experiment.experiment);
        experimentsCount += 1;
        const backtest = backtestingV2Engine.run({ experimentId: experiment.experiment.experimentId, strategy: compiled.strategy, candles, randomSeed: experiment.experiment.randomSeed, lineageEventIds: [observationEventId, hypothesisEventId, strategyEventId, experimentEventId], correlationId: input.correlationId, causationId: experimentEventId, spread: 0.0002, commissionPerTrade: 0, slippage: 0.0001 });
        const backtestEventId = firstEventId(backtest.events, "backtesting", backtest.result.backtestId);
        await repositories.backtests.save(backtest.result);
        backtestsCount += 1;
        const court = courtroom.open({
          strategyId: compiled.strategy.strategyId,
          strategyVersion: compiled.strategy.strategyVersion,
          hypothesisId: hypothesis.hypothesis.hypothesisId,
          experimentIds: [experiment.experiment.experimentId],
          backtests: [backtest.result],
          defenseExhibits: [{ exhibitId: `${backtest.result.backtestId}:defense`, sourceEventId: backtestEventId, kind: "defense", summary: "Deterministic bounded backtest result." }],
          prosecutionExhibits: backtest.result.aggregateMetrics.tradeCount < 30 ? [{ exhibitId: `${backtest.result.backtestId}:sample`, sourceEventId: backtestEventId, kind: "prosecution", summary: "Insufficient sample depth." }] : [],
          riskExhibits: [{ exhibitId: `${backtest.result.backtestId}:cost`, sourceEventId: backtestEventId, kind: "risk", summary: "Transaction costs applied." }],
          correlationId: input.correlationId,
          causationId: backtestEventId,
        });
        const courtEventId = firstEventId(court.events, "courtroom", court.courtCase.caseId);
        await repositories.courtroom.save({ ...court.courtCase, lineageEventIds: [backtestEventId, experimentEventId, hypothesisEventId] });
        verdictsCount += 1;
        rankingCandidates.push(candidateFromBacktest(court.courtCase.caseId, court.courtCase.verdict, compiled.strategy.strategyId, compiled.strategy.strategyVersion, hypothesis.hypothesis.hypothesisId, backtest.result, timeframe, courtEventId));
        if (experimentsCount >= this.config.maxExperimentsPerCycle || backtestsCount >= this.config.maxBacktestsPerCycle) break;
      }
    }
    if (rankingCandidates.length) {
      const ranked = ranking.rank({ candidates: rankingCandidates, maxFocusedCount: 1, correlationId: input.correlationId, causationId: rankingCandidates[0].lineageEventIds.at(-1) ?? input.cycleEventId, generatedAt: new Date().toISOString() });
      await repositories.ranking.save({ ...ranked.decision, schemaVersion: "fincoach.v2.ranking.1", lineageEventIds: rankingCandidates.flatMap(candidate => candidate.lineageEventIds) });
      rankedCount = ranked.decision.candidates.length;
    }
    structuredLogger.v2({ level: "info", event: "research_cycle_lineage_persisted", message: "V2 research cycle lineage persisted", cycleId: input.cycleId, correlationId: input.correlationId, runtimeInstanceId: this.bootId, observations: observationsCount, hypotheses: hypothesesCount, strategies: strategiesCount, experiments: experimentsCount, backtests: backtestsCount, verdicts: verdictsCount, rankedCandidates: rankedCount });
    v2TelemetryService.counter("v2_research_cycles_total", 1, { module: "orchestration", operation: "runOnce", resultClass: "success" });
    return { observations: observationsCount, hypotheses: hypothesesCount, strategies: strategiesCount, experiments: experimentsCount, backtests: backtestsCount, verdicts: verdictsCount, rankedCandidates: rankedCount, signals: 0, liveExecutionBlocked: true, telegramSignalsPublished: 0 };
  }
}

export function createFinCoachV2Runtime(env: NodeJS.ProcessEnv = process.env) {
  return new FinCoachV2Runtime(env);
}

let runtime: FinCoachV2Runtime | null = null;

export function getFinCoachV2Runtime(env: NodeJS.ProcessEnv = process.env) {
  if (!runtime) runtime = createFinCoachV2Runtime(env);
  return runtime;
}

function createRepositories(pool: Pool) {
  const evidence = {
    observations: new PgObservationRepository(pool),
    hypotheses: new PgHypothesisRepository(pool),
    experiments: new PgExperimentRepository(pool),
    backtests: new PgBacktestRepository(pool),
    strategies: new PgStrategyDefinitionRepository(pool),
    "court-cases": new PgCourtroomRepository(pool),
    "forward-tests": new PgForwardTestingRepository(pool),
    signals: new PgSignalRepository(pool),
    evaluations: new PgExternalEvaluationRepository(pool),
    journal: new PgResearchJournalRepository(pool),
    lessons: new PgLearningRepository(pool),
    lifecycle: new PgStrategyLifecycleRepository(pool),
    models: undefined,
  } satisfies Partial<Record<V2OperationsCollection, { listPage(input?: unknown): Promise<{ items: Record<string, unknown>[]; total: number }> } | undefined>>;
  return {
    operations: new PgV2OperationsRepository(pool),
    runtime: new PgV2RuntimeRepository(pool),
    orchestration: new PgOrchestrationRepository(pool),
    pilot: new PgDemoResearchPilotRepository(pool),
    courtroom: evidence["court-cases"],
    ranking: new PgRankingRepository(pool),
    forwardTesting: evidence["forward-tests"],
    signals: evidence.signals,
    evaluations: evidence.evaluations,
    journal: evidence.journal,
    learning: evidence.lessons,
    lifecycle: evidence.lifecycle,
    evolution: new PgStrategyEvolutionRepository(pool),
    observations: evidence.observations,
    hypotheses: evidence.hypotheses,
    experiments: evidence.experiments,
    backtests: evidence.backtests,
    strategies: evidence.strategies,
    evidence,
  };
}

function moduleDetails(config: V2RuntimeConfig, repositories: V2Repositories | null): Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>> {
  const disabled = (reason: string): V2ModuleAvailabilityDetail => ({ state: "disabled", reason });
  const notConfigured = (reason: string): V2ModuleAvailabilityDetail => ({ state: "not_configured", reason });
  const bound = (enabled: boolean, reason = "repository_bound_no_records"): V2ModuleAvailabilityDetail => enabled ? { state: "available_empty", reason } : disabled("module_disabled_by_configuration");
  if (!config.runtimeEnabled) {
    return Object.fromEntries([...collections(), "operations", "pilot"].map(item => [item, disabled("v2_runtime_disabled")])) as Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>>;
  }
  if (!repositories) {
    return Object.fromEntries([...collections(), "operations", "pilot"].map(item => [item, notConfigured("repository_not_injected")])) as Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>>;
  }
  return {
    operations: bound(true),
    orchestration: bound(true),
    pilot: config.pilotEnabled ? bound(true) : disabled("pilot_disabled_by_configuration"),
    observations: config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    hypotheses: config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    experiments: config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    backtests: config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    "court-cases": config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    strategies: config.researchEnabled ? bound(true) : disabled("research_disabled_by_configuration"),
    "forward-tests": config.forwardTestingEnabled ? bound(true) : disabled("forward_testing_disabled_by_configuration"),
    signals: config.researchSignalEnabled ? bound(true) : disabled("research_signal_creation_disabled"),
    evaluations: bound(config.researchEnabled),
    journal: bound(config.researchEnabled),
    lessons: bound(config.researchEnabled),
    lifecycle: bound(config.researchEnabled),
    models: notConfigured("durable_model_repository_not_implemented"),
  };
}

function collections(): V2OperationsCollection[] {
  return ["observations", "hypotheses", "experiments", "backtests", "court-cases", "strategies", "forward-tests", "signals", "evaluations", "journal", "lessons", "models", "lifecycle", "orchestration"];
}

function blockedReason(config: V2RuntimeConfig) {
  if (!config.runtimeEnabled) return "v2_runtime_disabled";
  if (!config.researchEnabled) return "v2_research_disabled";
  if (!config.pilotEnabled) return "v2_pilot_disabled";
  return "runtime_blocked";
}

function redactedConfig(config: V2RuntimeConfig) {
  return { ...config, liveExecutionEnabled: config.liveExecutionEnabled };
}

function classifyRuntimeErrorCode(error: unknown): OrchestrationErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot use a pool after calling end on the pool/i.test(message)) return "persistence_failure";
  if (/timeout/i.test(message)) return "retryable_dependency_failure";
  return "unknown_failure";
}

function normalizeTimeframe(value: string): V2Timeframe {
  const normalized = ({ M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D: "1d" } as Record<string, V2Timeframe>)[value] ?? value;
  return ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"].includes(normalized) ? normalized as V2Timeframe : "15m";
}

function demoCandles(symbol: string, timeframe: V2Timeframe, now: Date, count: number): NormalizedCandle[] {
  const step = 15 * 60_000;
  const seed = Number.parseInt(createHash("sha256").update(symbol).digest("hex").slice(0, 6), 16) / 0xffffff;
  const start = now.getTime() - count * step;
  return Array.from({ length: count }, (_, index) => {
    const base = 1 + seed / 10 + Math.sin(index / 5) * 0.002 + index * 0.00001;
    const open = Number(base.toFixed(6));
    const close = Number((base + Math.sin(index / 3) * 0.0008).toFixed(6));
    const high = Number((Math.max(open, close) + 0.0006).toFixed(6));
    const low = Number((Math.min(open, close) - 0.0006).toFixed(6));
    return { symbol, timeframe, timestamp: new Date(start + index * step).toISOString(), open, high, low, close, spread: 0.0002, volume: null, tickVolume: 100 + index, complete: true, source: { provider: "fincoach-deterministic-demo", providerSymbol: symbol, adapterVersion: "v1" }, corporateAction: null };
  });
}

function firstEventId(events: readonly DomainEvent[], sourceModule: string, parentEntityId: string) {
  const event = events[0];
  if (!event) throw new Error(`Missing ${sourceModule} domain event for ${parentEntityId}`);
  return event.eventId;
}

function candidateFromBacktest(courtCaseId: string, courtVerdict: RankingCandidateInput["courtVerdict"], strategyId: string, strategyVersion: number, hypothesisId: string, result: BacktestResult, timeframe: string, courtEventId: string): RankingCandidateInput {
  const metrics = result.aggregateMetrics;
  return {
    strategyId,
    strategyVersion,
    hypothesisId,
    courtCaseId,
    courtVerdict,
    metrics: {
      oosExpectancy: metrics.expectancy,
      confidenceInterval: 0.5,
      sampleDepth: metrics.sampleDepth,
      walkForwardStability: metrics.stability,
      parameterRobustness: 0.5,
      costResilience: Math.max(0, 1 - metrics.costSensitivity),
      maxDrawdown: metrics.maxDrawdown,
      tailRisk: 0.5,
      regimeDiversity: 0.2,
      operationalComplexity: 0.2,
      turnover: result.trades.length,
      exposure: 0.1,
    },
    similarityConfidence: 0.5,
    evidenceFreshness: 1,
    lineageEventIds: [...result.lineageEventIds, courtEventId],
    assetClass: "forex",
    timeframe,
    horizon: "short",
    correlationCluster: "deterministic-demo",
    rawReturn: metrics.netProfit,
  };
}
