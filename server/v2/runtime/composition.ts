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
import { ObservationsV2Service, breakoutDetector, compressionDetector, evidence as observationEvidence, stableHash } from "../observations";
import type { MarketObservation, ObservationSemanticGroup } from "../observations";
import { semanticGroupFromObservation, semanticGroupKey } from "../observations";
import { HypothesisV2Service } from "../hypothesis";
import type { ResearchHypothesis } from "../hypothesis";
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
  private schedulerStarted = false;

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
    if (this.schedulerStarted || this.timer) {
      structuredLogger.v2({ level: "info", event: "scheduler_duplicate_suppressed", message: "Duplicate V2 scheduler start suppressed", runtimeInstanceId: this.bootId, activeTimers: this.timer ? 1 : 0 });
      return this.status();
    }
    this.schedulerStarted = true;
    this.state = "running";
    const schedule = () => {
      if (!this.schedulerStarted || this.state === "stopping" || this.state === "stopped") return;
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
    this.schedulerStarted = false;
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
    const scheduledWindowStart = scheduledWindow(now, this.config.cadenceMs);
    const idempotencyKey = input.requestedBy?.startsWith("v2-autostart") ? `v2-cycle:${scheduledWindowStart}` : `v2-cycle:${input.requestedBy ?? "manual"}:${scheduledWindowStart}`;
    const cycleId = `cycle-${scheduledWindowStart}-${randomUUID().slice(0, 8)}`;
    structuredLogger.v2({ level: "info", event: "research_cycle_started", message: "V2 research cycle started", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, workerId, leaseName: lease.leaseName });
    const savedCycle = await repositories.orchestration.saveCycle({ cycleId, status: "requested", requestedBy: input.requestedBy ?? "manual", idempotencyKey, correlationId, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    if (!savedCycle.inserted) {
      await repositories.orchestration.releaseLease({ leaseName: lease.leaseName, workerId: lease.workerId, fencingToken: lease.fencingToken, now: new Date() }).catch(() => undefined);
      this.activeCycle = false;
      this.lastRunResult = { completed: false, reason: "duplicate_cycle_window_suppressed", idempotencyKey, liveExecutionBlocked: true };
      structuredLogger.v2({ level: "warn", event: "scheduler_duplicate_suppressed", message: "Duplicate V2 research cycle window suppressed", cycleId, correlationId, runtimeInstanceId: this.bootId, idempotencyKey });
      return this.lastRunResult;
    }
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
    let evaluationsAttempted = 0;
    let evaluationsCompleted = 0;
    let observationsDeduplicated = 0;
    let hypothesesEvaluated = 0;
    let hypothesesBlocked = 0;
    const blockers: Array<Record<string, unknown>> = [];
    const rankingCandidates: RankingCandidateInput[] = [];
    const semanticCandidates = new Map<string, ObservationSemanticGroup>();
    const candidateCausationIds = new Map<string, string>();

    const plans = buildObservationPlan(this.config);
    for (const plan of plans) {
      if (observationsCount >= this.config.maxObservationsPerCycle) break;
      const { symbol, timeframe, detector } = plan;
      evaluationsAttempted += 1;
      await saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "attempted", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() });
      structuredLogger.v2({ level: "info", event: "detector_evaluation_started", message: "V2 detector evaluation started", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId, strategyFamily: detector.capability?.strategyFamily });
      const candles = demoCandles(symbol, timeframe, input.now, 80);
      const lastCandle = candles.at(-1)!;
      if (!lastCandle.complete) {
        blockers.push(blocker("warning", "incomplete_candle_skipped", "observations", "Detector evaluation skipped because latest candle is incomplete.", false, true, "Wait for completed candle boundary.", input.now));
        await saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "skipped", reason: "incomplete_candle", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() });
        structuredLogger.v2({ level: "warn", event: "detector_evaluation_skipped", message: "V2 detector evaluation skipped", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId, reason: "incomplete_candle" });
        continue;
      }
      evaluationsCompleted += 1;
      const contextEventId = input.cycleEventId;
      const sourceDataIds = candles.slice(-40).map(candle => `${candle.source.provider}:${candle.symbol}:${candle.timeframe}:${candle.timestamp}`);
      const sourceDataHash = stableHash(candles.slice(-40).map(candle => ({ timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, spread: candle.spread, complete: candle.complete })));
      const metrics = metricsFromCandles(candles);
      const obs = observations.create({
        symbol,
        timeframe,
        observedAt: lastCandle.timestamp,
        candleStart: lastCandle.timestamp,
        candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(),
        lookbackStart: candles[0].timestamp,
        lookbackEnd: lastCandle.timestamp,
        marketDataSource: lastCandle.source.provider,
        sourceDataIds,
        sourceDataHash,
        inputSnapshotId: `snapshot:${sourceDataHash}`,
        metrics,
        detectorParameters: { detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, requiredCandles: detector.capability?.requiredCandles ?? 0 },
        contextEventId,
        upstreamEventIds: [input.cycleEventId],
        correlationId: input.correlationId,
        causationId: input.cycleEventId,
        evidence: [
          observationEvidence("chart", contextEventId, "volatility.compression", true, lastCandle.timestamp, { symbol, timeframe, candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), marketDataSource: lastCandle.source.provider, sourceDataIds, sourceDataHash, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, detectorParameters: { requiredCandles: detector.capability?.requiredCandles ?? 0 } }),
          observationEvidence("chart", contextEventId, "structure.breakOfStructure", true, lastCandle.timestamp, { symbol, timeframe, candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), marketDataSource: lastCandle.source.provider, sourceDataIds, sourceDataHash, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, detectorParameters: { requiredCandles: detector.capability?.requiredCandles ?? 0 } }),
        ],
      });
      const compatible = obs.observations.filter(observation => observation.detectorId === detector.detectorId).slice(0, this.config.maxObservationsPerCycle - observationsCount);
      for (const observation of compatible) {
        const observationEventId = firstEventId(obs.events, "observations", observation.observationId);
        addSemanticCandidate(semanticCandidates, observation);
        candidateCausationIds.set(semanticGroupKey(semanticGroupFromObservation(observation)), observationEventId);
        const saved = await repositories.observations.save(observation);
        if (!saved.inserted) {
          observationsDeduplicated += 1;
          const durableObservation = observationFromSaveResult(saved) ?? observation;
          addSemanticCandidate(semanticCandidates, durableObservation);
          await saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: observation.detectorId, detectorVersion: observation.detectorVersion, strategyFamily: observation.strategyFamily, status: "duplicate_suppressed", reason: "semantic_natural_key_conflict", candleStart: observation.candleStart, candleEnd: observation.candleEnd, sourceDataHash: observation.sourceDataHash, correlationId: input.correlationId, causationId: itemEventCausation(input.cycleEventId), createdAt: input.now.toISOString() });
          structuredLogger.v2({ level: "info", event: "observation_duplicate_suppressed", message: "Duplicate V2 observation suppressed", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: observation.detectorId, naturalKey: observation.naturalKey, semanticCandidateKey: semanticGroupKey(semanticGroupFromObservation(durableObservation)) });
          continue;
        }
        const durableObservation = observationFromSaveResult(saved) ?? observation;
        structuredLogger.v2({ level: "info", event: "observation_created", message: "V2 observation persisted", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: observation.detectorId, observationType: observation.observationType, confidence: observation.confidence, qualityScore: observation.qualityScore });
        addSemanticCandidate(semanticCandidates, durableObservation);
        observationsCount += 1;
      }
      await saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "completed", candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), sourceDataHash, correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() });
      structuredLogger.v2({ level: "info", event: "detector_evaluation_completed", message: "V2 detector evaluation completed", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId });
    }

    const durableGroups = await repositories.observations.eligibleSemanticGroups({
      lookbackHours: this.config.hypothesisLookbackHours,
      minimumQualityScore: 0.5,
      now: input.now,
      limit: hypothesisCandidateScanLimit(this.config),
    });
    for (const group of durableGroups) {
      semanticCandidates.set(semanticGroupKey(group), group);
    }

    for (const [candidateKey, candidate] of semanticCandidates) {
      if (hypothesesCount >= this.config.maxHypothesesPerCycle) break;
      const support = await historicalSupport(repositories.observations, candidate, this.config, input.now);
      hypothesesEvaluated += 1;
      const supportTimestamps = support.map(obs => obs.candleEnd ?? obs.observedAt).sort();
      const commonPayload = {
        semanticCandidateKey: candidateKey,
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        detector: candidate.detectorId,
        observationType: candidate.observationType,
        strategyFamily: candidate.strategyFamily ?? "unknown",
        eligibleObservationCount: support.length,
        independentOccurrenceCount: independentOccurrenceCount(support),
        requiredOccurrenceCount: this.config.minIndependentHypothesisOccurrences,
        oldestSupportingTimestamp: supportTimestamps[0] ?? null,
        newestSupportingTimestamp: supportTimestamps.at(-1) ?? null,
      };
      structuredLogger.v2({ level: "info", event: "hypothesis_candidate_evaluated", message: "V2 hypothesis candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload });
      if (support.length < this.config.minIndependentHypothesisOccurrences || independentOccurrenceCount(support) < this.config.minIndependentHypothesisOccurrences) {
        hypothesesBlocked += 1;
        blockers.push(blocker("critical", "hypothesis_insufficient_independent_occurrences", "hypothesis", "Not enough distinct candle windows to create hypothesis.", independentOccurrenceCount(support), this.config.minIndependentHypothesisOccurrences, "Collect another complete candle occurrence with full lineage.", input.now));
        structuredLogger.v2({ level: "warn", event: "hypothesis_insufficient_independent_occurrences", message: "V2 hypothesis candidate blocked", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, blocker: "insufficient_independent_occurrences" });
        continue;
      }
      if (new Set(support.flatMap(obs => obs.evidence.map(ev => ev.evidenceId))).size < this.config.minIndependentHypothesisOccurrences) {
        hypothesesBlocked += 1;
        blockers.push(blocker("critical", "hypothesis_rejected_duplicate_evidence", "hypothesis", "Supporting observations reuse evidence IDs.", support.length, this.config.minIndependentHypothesisOccurrences, "Ensure evidence fingerprints include symbol, timeframe, detector, candle range, and source hash.", input.now));
        structuredLogger.v2({ level: "warn", event: "hypothesis_rejected_duplicate_evidence", message: "V2 hypothesis candidate blocked", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, blocker: "duplicate_evidence" });
        continue;
      }
      const sourceObservationIds = [...new Set(support.map(obs => obs.observationId))];
      const evidenceEventIds = [...new Set(support.flatMap(obs => obs.evidence.map(ev => ev.evidenceId)))];
      const hypothesis = hypotheses.generate({
          statement: `${candidate.symbol} ${candidate.timeframe} ${candidate.observationType} may have positive expectancy after costs.`,
          targetPopulation: { symbols: [candidate.symbol], assetClasses: ["forex"], timeframes: [candidate.timeframe], sessions: ["all"], regimes: ["demo"] },
          conditions: [{ field: "observationType", operator: "in", value: [candidate.observationType] }],
          expectedOutcome: { metric: "expectancy", operator: ">", value: 0, horizon: "next_bar" },
          baseline: { baselineId: "zero-edge", description: "No edge after costs", metric: "expectancy", value: 0 },
          invalidationCriteria: [{ field: "costSensitivity", operator: ">", value: 0.5 }],
          minimumSampleSize: 30,
          minimumIndependentOccurrences: this.config.minIndependentHypothesisOccurrences,
          mechanism: "Compression can precede directional expansion, but this remains unproven until backtested.",
          evidenceEventIds,
          contradictoryEvidenceEventIds: [],
          sourceObservationIds,
          sourceTraderAnalysisIds: [],
          correlationId: input.correlationId,
          causationId: candidateCausationIds.get(candidateKey) ?? input.cycleEventId,
          createdAt: input.now.toISOString(),
        });
        if (!hypothesis.hypothesis) continue;
        const savedHypothesis = await repositories.hypotheses.save(hypothesis.hypothesis);
        const persistedHypothesis = hypothesisFromSaveResult(savedHypothesis) ?? hypothesis.hypothesis;
        if (!savedHypothesis.inserted) {
          structuredLogger.v2({ level: "info", event: "hypothesis_duplicate_suppressed", message: "Duplicate V2 hypothesis suppressed", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, hypothesisId: persistedHypothesis.hypothesisId, hypothesisFingerprint: persistedHypothesis.fingerprint, inserted: false, conflict: conflictFromSaveResult(savedHypothesis) ?? "idempotent", skipReason: "hypothesis_save_not_inserted" });
          continue;
        }
        const hypothesisEventId = firstEventId(hypothesis.events, "hypothesis", persistedHypothesis.hypothesisId);
        hypothesesCount += 1;
        structuredLogger.v2({ level: "info", event: "hypothesis_created", message: "V2 hypothesis persisted", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, hypothesisId: persistedHypothesis.hypothesisId, hypothesisFingerprint: persistedHypothesis.fingerprint, inserted: true, conflict: null });
        if (hypothesesCount > this.config.maxHypothesesPerCycle) break;
        const compiled = rulesV2Compiler.compile({
          hypothesisId: persistedHypothesis.hypothesisId,
          name: `V2 demo ${candidate.symbol} compression breakout`,
          assetClasses: ["forex"],
          symbols: [candidate.symbol],
          timeframes: [candidate.timeframe],
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
          hypothesisId: persistedHypothesis.hypothesisId,
          strategyId: compiled.strategy.strategyId,
          strategyVersion: compiled.strategy.strategyVersion,
          experimentType: "baseline_backtest",
          datasetSpecification: { symbols: [candidate.symbol], timeframes: [candidate.timeframe], start: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80)[0].timestamp, end: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80).at(-1)!.timestamp },
          parameterSpecification: {},
          holdoutPolicy: { trainEnd: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80)[40].timestamp, validationEnd: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80)[60].timestamp, testStart: new Date(Date.parse(demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80).at(-1)!.timestamp) + 60_000).toISOString(), finalHoldoutLocked: true },
          randomSeed: "deterministic-demo-seed",
          resourceBudget: { maxCandles: 80, maxRuntimeMs: this.config.cycleTimeoutMs },
          priority: 1,
          maxAttempts: this.config.retryBudget,
          correlationId: input.correlationId,
          causationId: strategyEventId,
          createdAt: input.now.toISOString(),
        });
        const experimentEventId = firstEventId(experiment.events, "experiments", experiment.experiment.experimentId);
        await repositories.experiments.save(experiment.experiment);
        experimentsCount += 1;
        const backtestCandles = demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80);
        const observationLineageEventId = candidateCausationIds.get(candidateKey) ?? input.cycleEventId;
        const backtest = backtestingV2Engine.run({ experimentId: experiment.experiment.experimentId, strategy: compiled.strategy, candles: backtestCandles, randomSeed: experiment.experiment.randomSeed, lineageEventIds: [observationLineageEventId, hypothesisEventId, strategyEventId, experimentEventId], correlationId: input.correlationId, causationId: experimentEventId, spread: 0.0002, commissionPerTrade: 0, slippage: 0.0001 });
        const backtestEventId = firstEventId(backtest.events, "backtesting", backtest.result.backtestId);
        await repositories.backtests.save(backtest.result);
        backtestsCount += 1;
        const court = courtroom.open({
          strategyId: compiled.strategy.strategyId,
          strategyVersion: compiled.strategy.strategyVersion,
          hypothesisId: persistedHypothesis.hypothesisId,
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
        rankingCandidates.push(candidateFromBacktest(court.courtCase.caseId, court.courtCase.verdict, compiled.strategy.strategyId, compiled.strategy.strategyVersion, persistedHypothesis.hypothesisId, backtest.result, candidate.timeframe, courtEventId));
        if (experimentsCount >= this.config.maxExperimentsPerCycle || backtestsCount >= this.config.maxBacktestsPerCycle) break;
    }
    if (rankingCandidates.length) {
      const ranked = ranking.rank({ candidates: rankingCandidates, maxFocusedCount: 1, correlationId: input.correlationId, causationId: rankingCandidates[0].lineageEventIds.at(-1) ?? input.cycleEventId, generatedAt: new Date().toISOString() });
      await repositories.ranking.save({ ...ranked.decision, schemaVersion: "fincoach.v2.ranking.1", lineageEventIds: rankingCandidates.flatMap(candidate => candidate.lineageEventIds) });
      rankedCount = ranked.decision.candidates.length;
    }
    const completedEvent = blockers.length ? "pipeline_cycle_completed_with_blockers" : "pipeline_cycle_completed";
    structuredLogger.v2({ level: "info", event: completedEvent, message: "V2 research cycle lineage persisted", cycleId: input.cycleId, correlationId: input.correlationId, runtimeInstanceId: this.bootId, evaluationsAttempted, evaluationsCompleted, observations: observationsCount, observationsDeduplicated, hypothesesEvaluated, hypotheses: hypothesesCount, hypothesesBlocked, strategies: strategiesCount, experiments: experimentsCount, backtests: backtestsCount, verdicts: verdictsCount, rankedCandidates: rankedCount, blockers });
    v2TelemetryService.counter("v2_research_cycles_total", 1, { module: "orchestration", operation: "runOnce", resultClass: "success" });
    return { status: blockers.length ? "completed_with_blockers" : "completed", evaluationsAttempted, evaluationsCompleted, observationsCreated: observationsCount, observationsDeduplicated, hypothesesEvaluated, hypothesesCreated: hypothesesCount, hypothesesBlocked, strategiesCreated: strategiesCount, experimentsQueued: experimentsCount, backtestsCompleted: backtestsCount, verdictsCreated: verdictsCount, rankedCandidates: rankedCount, forwardTestsCreated: 0, signalsCreated: 0, lifecycleDecisions: 0, blockers, liveExecutionBlocked: true, telegramSignalsPublished: 0 };
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

function scheduledWindow(now: Date, cadenceMs: number) {
  const safeCadenceMs = Math.max(60_000, cadenceMs);
  return new Date(Math.floor(now.getTime() / safeCadenceMs) * safeCadenceMs).toISOString();
}

function normalizeTimeframe(value: string): V2Timeframe {
  const normalized = ({ M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H3: "3h", H4: "4h", H6: "6h", D: "1d", W: "1w", "1hr": "1h", "1day": "1d", "1week": "1w" } as Record<string, V2Timeframe>)[value] ?? value;
  return ["1m", "5m", "15m", "30m", "1h", "3h", "4h", "6h", "1d", "1w", "1mo"].includes(normalized) ? normalized as V2Timeframe : "15m";
}

function demoCandles(symbol: string, timeframe: V2Timeframe, now: Date, count: number): NormalizedCandle[] {
  const step = timeframeMs(timeframe);
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

function buildObservationPlan(config: V2RuntimeConfig) {
  const detectors = [compressionDetector, breakoutDetector].filter(detector => detector.capability?.enabled !== false);
  const plans = [];
  for (const symbol of config.symbols) {
    for (const timeframe of config.timeframes.map(normalizeTimeframe)) {
      for (const detector of detectors) {
        if (!detector.capability?.supportedTimeframes.includes(timeframe)) continue;
        plans.push({ symbol, timeframe, detector });
      }
    }
  }
  return plans.slice(0, Math.max(config.targetEvaluationsPerHour, config.maxObservationsPerCycle));
}

function addSemanticCandidate(candidates: Map<string, ObservationSemanticGroup>, observation: MarketObservation) {
  const group = semanticGroupFromObservation(observation);
  candidates.set(semanticGroupKey(group), group);
}

function hypothesisCandidateScanLimit(config: V2RuntimeConfig) {
  return Math.max(config.maxHypothesesPerCycle * 4, config.minIndependentHypothesisOccurrences * 4, 20);
}

async function historicalSupport(repository: V2Repositories["observations"], candidate: ObservationSemanticGroup, config: V2RuntimeConfig, now: Date) {
  return repository.eligibleForHypothesis({
    ...candidate,
    lookbackHours: config.hypothesisLookbackHours,
    minimumQualityScore: 0.5,
    now,
    limit: hypothesisCandidateScanLimit(config),
  });
}

function observationFromSaveResult(saved: unknown): MarketObservation | null {
  const result = saved as { record?: MarketObservation; observation?: MarketObservation; existing?: MarketObservation };
  return result.record ?? result.observation ?? result.existing ?? null;
}

function hypothesisFromSaveResult(saved: unknown): ResearchHypothesis | null {
  const result = saved as { record?: ResearchHypothesis; hypothesis?: ResearchHypothesis; existing?: ResearchHypothesis };
  return result.record ?? result.hypothesis ?? result.existing ?? null;
}

function conflictFromSaveResult(saved: unknown) {
  return (saved as { conflict?: string }).conflict;
}

function independentOccurrenceCount(observations: import("../observations").MarketObservation[]) {
  return new Set(observations.map(observation => `${observation.symbol}:${observation.timeframe}:${observation.candleStart ?? observation.observedAt}:${observation.candleEnd ?? observation.observedAt}`)).size;
}

function metricsFromCandles(candles: NormalizedCandle[]) {
  const last = candles.at(-1)!;
  const previous = candles.at(-2);
  const returns = candles.slice(1).map((candle, index) => candle.close / candles[index].close - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, returns.length);
  const ranges = candles.map(candle => candle.high - candle.low);
  const atr = ranges.slice(-14).reduce((sum, value) => sum + value, 0) / Math.max(1, ranges.slice(-14).length);
  const recentRange = ranges.slice(-10).reduce((sum, value) => sum + value, 0) / 10;
  const priorRange = ranges.slice(-30, -10).reduce((sum, value) => sum + value, 0) / 20;
  return {
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    previousClose: previous?.close,
    volume: last.volume ?? last.tickVolume ?? undefined,
    spread: last.spread ?? undefined,
    atr: Number(atr.toFixed(6)),
    realizedVolatility: Number(Math.sqrt(variance).toFixed(6)),
    compressionRatio: Number((recentRange / Math.max(priorRange, 0.000001)).toFixed(4)),
    breakoutLevel: Number(Math.max(...candles.slice(-20, -1).map(candle => candle.high)).toFixed(6)),
    breakoutDistance: Number((last.close - Math.max(...candles.slice(-20, -1).map(candle => candle.high))).toFixed(6)),
    return1: previous ? Number((last.close / previous.close - 1).toFixed(6)) : undefined,
    returnN: Number((last.close / candles[0].close - 1).toFixed(6)),
    sampleSize: candles.length,
  };
}

function nextCandleBoundary(timestamp: string, timeframe: V2Timeframe) {
  return new Date(Date.parse(timestamp) + timeframeMs(timeframe));
}

function timeframeMs(timeframe: V2Timeframe) {
  return ({ "1m": 60_000, "5m": 5 * 60_000, "15m": 15 * 60_000, "30m": 30 * 60_000, "1h": 60 * 60_000, "3h": 3 * 60 * 60_000, "4h": 4 * 60 * 60_000, "6h": 6 * 60 * 60_000, "1d": 24 * 60 * 60_000, "1w": 7 * 24 * 60 * 60_000, "1mo": 30 * 24 * 60 * 60_000 } as Record<V2Timeframe, number>)[timeframe] ?? 15 * 60_000;
}

function blocker(severity: "info" | "warning" | "critical", code: string, phase: string, reason: string, currentValue: unknown, requiredValue: unknown, recommendedAction: string, now: Date) {
  return { severity, code, phase, reason, currentValue, requiredValue, recommendedAction, firstObservedAt: now.toISOString(), lastObservedAt: now.toISOString() };
}

async function saveDetectorEvaluation(repository: unknown, input: Omit<Parameters<PgV2OperationsRepository["saveDetectorEvaluation"]>[0], "evaluationId">) {
  if (!repository || typeof (repository as { saveDetectorEvaluation?: unknown }).saveDetectorEvaluation !== "function") return;
  const evaluationId = stableHash({ cycleId: input.cycleId, symbol: input.symbol, timeframe: input.timeframe, detectorId: input.detectorId, status: input.status, candleEnd: input.candleEnd, sourceDataHash: input.sourceDataHash });
  await (repository as PgV2OperationsRepository).saveDetectorEvaluation({ ...input, evaluationId }).catch((error) => {
    structuredLogger.v2Error({ level: "error", event: "detector_evaluation_failed", message: "Failed to persist V2 detector evaluation metric", error });
  });
}

function itemEventCausation(causationId: string) {
  return causationId;
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
