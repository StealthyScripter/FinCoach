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
import type { CycleAdmissionResult, DurableWorkerLease, OrchestrationErrorCode, ResearchCycleRecord } from "../orchestration/contracts";
import { ObservationsV2Service, breakoutDetector, compressionDetector, liquiditySweepDetector, evidence as observationEvidence, stableHash } from "../observations";
import type { MarketObservation, ObservationSemanticGroup } from "../observations";
import { semanticGroupFromObservation, semanticGroupKey } from "../observations";
import { HypothesisV2Service } from "../hypothesis";
import type { ResearchHypothesis } from "../hypothesis";
import { rulesV2Compiler } from "../rules";
import { ExperimentsV2Service } from "../experiments";
import { backtestingV2Engine, type BacktestResult } from "../backtesting";
import { CourtroomV2Service, forwardTestVerdictEligibility } from "../courtroom";
import { RankingV2Service, type RankingCandidateInput, type StrategyRankingDecision } from "../ranking";
import { ForwardTestingV2Service, type ForwardTestRecord } from "../forward-testing";
import { SignalsV2Service, evaluateSignalEligibility, type V2ResearchSignal } from "../signals";
import { ExternalEvaluationV2Service, type ExternalEvaluation } from "../external-evaluation";
import { ResearchJournalV2Service, type ResearchJournalEntry } from "../journal";
import { LearningV2Service, type LearningLesson, type LearningOutcome } from "../learning";
import { StrategyLifecycleV2Service, type StrategyLifecycleDecision } from "../strategy-lifecycle";
import { evaluateEvaluationForJournalEligibility, evaluateJournalForLessonEligibility, evaluateLessonForLifecycleEligibility, evaluateSignalForEvaluationEligibility } from "./postSignalEligibility";
import type { NormalizedCandle, V2Timeframe } from "../market-data";
import type { StrategyDefinition } from "../rules";
import { v2TelemetryService } from "../telemetry";
import { loadV2RuntimeConfig, type V2RuntimeConfig, type V2RuntimeConfigValidation } from "./config";
import { memorySnapshot } from "./memory";
import { PgV2RuntimeRepository } from "./repository";
import { weeklyResearchWindowState, type WeeklyResearchWindowState } from "./weeklyResearchWindow";
import { marketSessionsService, type AggregateTradableWindow } from "../../marketSessionsService";
import { eventLogService } from "../../eventLogService";
import { structuredLogger } from "../../structuredLogger";
import { deploymentMetadata } from "../../deploymentMetadata";
import { emitResearchCycleObserverSummaries, emitSafetyStateSnapshot, type MarketDataCoverage } from "../../observerTelemetry";
import { createDomainEvent, type DomainEvent } from "../contracts";
import { OrchestrationV2EventTypes } from "../orchestration/events";
import { marketSnapshotService } from "../../marketSnapshotService";
import { resolveResearchInstrument, validateResearchUniverse } from "../researchUniverse";
import { activeFxResearchSession, type FxResearchSessionId } from "../fxResearchSessions";
import { classifyRegimeFromObservation, instantiateStrategyTemplates } from "../strategyTemplates";

type V2Repositories = ReturnType<typeof createRepositories>;
type WeeklyTransitionNotifier = (input: { kind: "open" | "close"; boundaryAt: string; window: WeeklyResearchWindowState; aggregate: AggregateTradableWindow }) => Promise<unknown>;
let weeklyTransitionNotifier: WeeklyTransitionNotifier | null = null;

export type V2RuntimeState = "disabled" | "initialized" | "running" | "idle" | "blocked" | "failed" | "stopping" | "stopped" | "scheduled_closed" | "suspended_waiting_for_market" | "starting_for_week" | "stopping_for_week" | "calendar_unavailable" | "configuration_blocked";

export class FinCoachV2Runtime {
  private pool: Pool | null = null;
  private repositories: V2Repositories | null = null;
  private timer: NodeJS.Timeout | null = null;
  private weeklyTimer: NodeJS.Timeout | null = null;
  private bootId = randomUUID();
  private state: V2RuntimeState = "disabled";
  private lastRunAt: string | null = null;
  private lastRunResult: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private nextScheduledCycleAt: string | null = null;
  private activeCycle = false;
  private schedulerStarted = false;
  private lastWeeklyWindowReason: string | null = null;
  private lastWeeklyTransition: Record<string, unknown> | null = null;
  private pendingWeeklyTransitionAt: string | null = null;
  private pendingWeeklyTransitionKind: "lead" | "open" | "close" | null = null;
  private pendingWeeklyTransitionSource: string | null = null;
  private pendingWeeklyTransitionReason: string | null = null;

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
      this.logSafetyStateSnapshot("configuration_checked");
      if (validation.config.runtimeEnabled) throw new Error(`V2 runtime configuration failed: ${validation.errors.join("; ")}`);
      return this.status();
    }
    if (!validation.config.runtimeEnabled) {
      this.state = "disabled";
      configureV2OperationsService(this.createOperationsService(null));
      structuredLogger.v2({ level: "info", event: "v2_runtime_disabled", message: "V2 runtime disabled by configuration", runtimeInstanceId: this.bootId, configuration: { config: redactedConfig(validation.config), warnings: validation.warnings } });
      this.logSafetyStateSnapshot("runtime_disabled");
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
    this.logSafetyStateSnapshot("runtime_initialized");
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
    if (this.config.weeklyResearchSchedule.enabled) {
      await this.applyWeeklyWindow("startup");
    } else {
      this.startCadence("v2-autostart-initial");
    }
    return this.status();
  }

  async stop(reason = "runtime_stop") {
    structuredLogger.v2({ level: "info", event: "v2_runtime_stopping", message: "V2 runtime stopping", runtimeInstanceId: this.bootId, reason });
    this.state = "stopping";
    this.schedulerStarted = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.weeklyTimer) clearTimeout(this.weeklyTimer);
    this.timer = null;
    this.weeklyTimer = null;
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
    if (this.config.autostart && this.config.weeklyResearchSchedule.enabled) await this.applyWeeklyWindow("resume");
    else this.state = this.config.autostart ? "running" : "idle";
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
    const aggregate = marketSessionsService.aggregateTradableWindow(new Date());
    if (this.config.weeklyResearchSchedule.enabled && !aggregate.anyConfiguredInstrumentTradable) {
      this.state = aggregate.calendarQuality === "unavailable" ? "calendar_unavailable" : "suspended_waiting_for_market";
      this.lastError = "weekly_market_window_closed";
      this.lastRunResult = {
        completed: false,
        reason: "weekly_market_window_closed",
        currentWindowClosesAt: aggregate.finalWeeklyCloseAt,
        nextWindowOpensAt: aggregate.nextTradableOpenAt,
        liveExecutionBlocked: true,
      };
      this.logAggregateWindowState(aggregate);
      return this.lastRunResult;
    }
    if (this.activeCycle) {
      structuredLogger.v2({ level: "warn", event: "research_cycle_suppressed", message: "V2 research cycle suppressed because one is already active", runtimeInstanceId: this.bootId, requestedBy: input.requestedBy ?? "manual" });
      return { completed: false, reason: "cycle_already_active" };
    }
    const correlationId = randomUUID();
    const workerId = `v2-runtime-${process.pid}-${this.bootId}`;
    const startedAt = Date.now();
    const now = new Date();
    const recovered = await recoverStaleCycles(repositories.orchestration, { now, staleAfterMs: this.config.cycleTimeoutMs + this.config.leaseTtlMs, correlationId });
    if (recovered.length) {
      structuredLogger.v2({ level: "warn", event: "stale_cycle_recovered", message: "Recovered stale V2 running cycles", correlationId, runtimeInstanceId: this.bootId, recoveredCycles: recovered.map(cycle => cycle.cycleId) });
    }
    const scheduledWindowStart = scheduledWindow(now, this.config.cadenceMs);
    const idempotencyKey = input.requestedBy?.startsWith("v2-autostart") ? `v2-cycle:${scheduledWindowStart}` : `v2-cycle:${input.requestedBy ?? "manual"}:${scheduledWindowStart}`;
    const cycleId = `cycle-${scheduledWindowStart}-${randomUUID().slice(0, 8)}`;
    const admission = await admitResearchCycle(repositories.orchestration, {
      cycle: { cycleId, status: "requested", requestedBy: input.requestedBy ?? "manual", idempotencyKey, correlationId, createdAt: now.toISOString(), updatedAt: now.toISOString(), payload: { requestedBy: input.requestedBy ?? "manual" } },
      maxCyclesPerDay: this.config.maxCyclesPerDay,
      now,
      admissionTimezone: "UTC",
    });
    if (!admission.admitted) {
      this.lastError = admission.reason ?? "cycle_admission_rejected";
      this.lastRunResult = { completed: false, reason: this.lastError, idempotencyKey, admissionDate: admission.admissionDate, admittedCount: admission.admittedCount, maxCyclesPerDay: admission.limit, liveExecutionBlocked: true };
      structuredLogger.v2({ level: "warn", event: admission.reason === "daily_limit_reached" ? "cycle_daily_limit_reached" : "cycle_admission_rejected", message: "V2 research cycle admission rejected", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, reason: this.lastError, admissionDate: admission.admissionDate, admittedCount: admission.admittedCount, limit: admission.limit });
      return this.lastRunResult;
    }
    structuredLogger.v2({ level: "info", event: "cycle_admission_granted", message: "V2 research cycle admission granted", cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, admissionDate: admission.admissionDate, admittedCount: admission.admittedCount, limit: admission.limit });
    const admittedCycle = (admission.cycle ?? { cycleId, idempotencyKey }) as Pick<ResearchCycleRecord, "cycleId" | "idempotencyKey">;
    const lease = await repositories.orchestration.acquireLease({ leaseName: "fincoach-v2-runtime", workerId, now: new Date(), ttlMs: this.config.leaseTtlMs, correlationId });
    if (!lease) {
      this.state = "blocked";
      this.lastError = "runtime_lease_unavailable";
      await repositories.orchestration.updateCycleStatus({ cycleId: admittedCycle.cycleId, status: "failed", reason: "lease_unavailable" }).catch(() => undefined);
      this.lastRunResult = { cycleId: admittedCycle.cycleId, completed: false, reason: this.lastError, liveExecutionBlocked: true };
      structuredLogger.v2({ level: "warn", event: "lease_acquisition_rejected", message: "V2 research cycle could not acquire runtime lease", cycleId: admittedCycle.cycleId, correlationId, runtimeInstanceId: this.bootId, requestedBy: input.requestedBy ?? "manual", reason: this.lastError });
      return this.lastRunResult;
    }
    structuredLogger.v2({ level: "info", event: "lease_acquired", message: "V2 runtime lease acquired", cycleId: admittedCycle.cycleId, correlationId, runtimeInstanceId: this.bootId, leaseKey: lease.leaseName, ownerId: safeOwnerId(lease.workerId), fencingToken: lease.fencingToken });
    this.activeCycle = true;
    const guard = new CycleLeaseGuard(repositories.orchestration, lease, { ttlMs: this.config.leaseTtlMs, renewIntervalMs: this.config.leaseRenewIntervalMs, correlationId, cycleId: admittedCycle.cycleId, runtimeInstanceId: this.bootId });
    const timeout = setTimeout(() => guard.cancel("cycle_timeout"), this.config.cycleTimeoutMs);
    timeout.unref?.();
    const cycleRequested = createDomainEvent({ eventType: OrchestrationV2EventTypes.ResearchCycleRequested, sourceModule: "orchestration", correlationId, causationId: null, payload: { cycleId: admittedCycle.cycleId, requestedBy: input.requestedBy ?? "manual" } });
    try {
      await repositories.orchestration.updateCycleStatus({ cycleId: admittedCycle.cycleId, status: "running", lease });
      guard.start();
      structuredLogger.v2({ level: "info", event: "research_cycle_started", message: "V2 research cycle started", cycleId: admittedCycle.cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, ownerId: safeOwnerId(lease.workerId), leaseKey: lease.leaseName, fencingToken: lease.fencingToken });
      const result = await Promise.race([
        this.runResearchPath({ cycleId: admittedCycle.cycleId, cycleEventId: cycleRequested.eventId, correlationId, now, guard }),
        guard.waitForLoss("research_cycle"),
      ]);
      await guard.assertOwned("cycle_completion");
      await repositories.orchestration.updateCycleStatus({ cycleId: admittedCycle.cycleId, status: "completed", lease });
      await guard.assertOwned("cycle_checkpoint");
      await repositories.orchestration.checkpoint({ consumerId: "v2-runtime-cycle", sourceEventId: admittedCycle.cycleId, idempotencyKey: admittedCycle.cycleId, checkpointedAt: new Date().toISOString(), attempt: 1, correlationId });
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      this.lastRunResult = { ...result, cycleId: admittedCycle.cycleId, completed: true };
      this.state = this.config.autostart ? "running" : "idle";
      structuredLogger.v2({ level: "info", event: "research_cycle_completed", message: "V2 research cycle completed", cycleId: admittedCycle.cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, durationMs: Date.now() - startedAt, result });
      return this.lastRunResult;
    } catch (error) {
      const reason = cycleFailureReason(error, guard);
      if (reason !== "lease_lost") {
        await repositories.orchestration.updateCycleStatus({ cycleId: admittedCycle.cycleId, status: "failed", reason, lease }).catch(() => undefined);
      }
      const nextRetryAt = null;
      await guard.tryAssertOwned("retry_record").then(ok => ok ? repositories.orchestration.saveRetry({ sourceEventId: admittedCycle.cycleId, consumerId: "v2-runtime-cycle", idempotencyKey: `${admittedCycle.cycleId}:retry`, attempt: 1, maxAttempts: this.config.retryBudget, exhausted: this.config.retryBudget <= 1, nextRetryAt, lastErrorCode: classifyRuntimeErrorCode(error), correlationId, causationId: null }) : null).catch(() => undefined);
      this.lastError = reason;
      this.lastRunResult = { cycleId: admittedCycle.cycleId, completed: false, reason, liveExecutionBlocked: true };
      this.state = "failed";
      structuredLogger.v2Error({ level: "error", event: reason === "cycle_timeout" ? "cycle_timed_out" : reason === "lease_lost" ? "lease_lost" : "research_cycle_failed", message: "Research cycle failed", cycleId: admittedCycle.cycleId, correlationId, requestedBy: input.requestedBy ?? "manual", runtimeInstanceId: this.bootId, durationMs: Date.now() - startedAt, retryAttempt: 1, nextRetryAt, reason, error });
      return this.lastRunResult;
    } finally {
      clearTimeout(timeout);
      guard.stop();
      this.activeCycle = false;
      const released = await repositories.orchestration.releaseLease({ leaseName: lease.leaseName, workerId: lease.workerId, fencingToken: lease.fencingToken, now: new Date() }).catch(() => false);
      structuredLogger.v2({ level: released ? "info" : "warn", event: released ? "lease_release_succeeded" : "lease_release_skipped", message: released ? "V2 runtime lease released" : "V2 runtime lease release skipped due to ownership mismatch", cycleId: admittedCycle.cycleId, correlationId, runtimeInstanceId: this.bootId, leaseKey: lease.leaseName, ownerId: safeOwnerId(lease.workerId), fencingToken: lease.fencingToken });
    }
  }

  status() {
    const weeklyWindow = weeklyResearchWindowState(this.config.weeklyResearchSchedule, new Date());
    const previousConfiguredWeeklyCloseAt = weeklyResearchWindowState(this.config.weeklyResearchSchedule, new Date(Date.now() - 7 * 24 * 60 * 60_000)).nextWindowClosesAt;
    const continuousMarketPause = weeklyResearchWindowState({
      enabled: this.config.continuousMarketWeeklyPause.enabled,
      timezone: this.config.continuousMarketWeeklyPause.timezone,
      openDay: this.config.continuousMarketWeeklyPause.resumeDay,
      openTime: this.config.continuousMarketWeeklyPause.resumeTime,
      closeDay: this.config.continuousMarketWeeklyPause.pauseDay,
      closeTime: this.config.continuousMarketWeeklyPause.pauseTime,
      startLeadMinutes: 0,
    }, new Date());
    const aggregateTradableWindow = marketSessionsService.aggregateTradableWindow(new Date());
    const researchUniverse = validateResearchUniverse(this.config.symbols);
    const activeTimers = (this.timer ? 1 : 0) + (this.weeklyTimer ? 1 : 0);
    const memory = memorySnapshot({ eventLogItems: eventLogService.snapshot().eventCount, activeCycles: this.activeCycle ? 1 : 0, activeTimers });
    return {
      schemaVersion: "fincoach.v2.runtime-status.1",
      bootId: this.bootId,
      state: this.state,
      config: redactedConfig(this.config),
      configProvenance: this.configValidation.provenance,
      configuration: { ok: this.configValidation.ok, errors: this.configValidation.errors, warnings: this.configValidation.warnings },
      lastRunAt: this.lastRunAt,
      lastRunResult: this.lastRunResult,
      lastError: this.lastError,
      nextScheduledCycleAt: this.nextScheduledCycleAt,
      weeklyResearchSchedule: {
        enabled: this.config.weeklyResearchSchedule.enabled,
        timezone: this.config.weeklyResearchSchedule.timezone,
        openDay: this.config.weeklyResearchSchedule.openDay,
        openTime: this.config.weeklyResearchSchedule.openTime,
        closeDay: this.config.weeklyResearchSchedule.closeDay,
        closeTime: this.config.weeklyResearchSchedule.closeTime,
        startLeadMinutes: this.config.weeklyResearchSchedule.startLeadMinutes,
        currentWindow: weeklyWindow,
        nextOpen: weeklyWindow.nextWindowOpensAt,
        nextClose: weeklyWindow.nextWindowClosesAt,
        configuredWeeklyCloseAt: weeklyWindow.nextWindowClosesAt,
        previousConfiguredWeeklyCloseAt,
        aggregateFinalTradableCloseAt: aggregateTradableWindow.finalWeeklyCloseAt,
        continuousMarketPauseAt: continuousMarketPause.currentWindowClosesAt ?? continuousMarketPause.nextWindowClosesAt,
        nextWakeAt: this.pendingWeeklyTransitionAt,
        nextWakeKind: this.pendingWeeklyTransitionKind,
        nextWakeSource: this.pendingWeeklyTransitionSource,
        nextWakeReason: this.pendingWeeklyTransitionReason,
        wakeTimerActive: Boolean(this.weeklyTimer),
        timerActive: Boolean(this.weeklyTimer),
      },
      aggregateTradableWindow: {
        anyConfiguredInstrumentTradable: aggregateTradableWindow.anyConfiguredInstrumentTradable,
        finalWeeklyCloseAt: aggregateTradableWindow.finalWeeklyCloseAt,
        nextTradableOpenAt: aggregateTradableWindow.nextTradableOpenAt,
        instrumentsRemainingOpen: aggregateTradableWindow.instrumentsRemainingOpen,
        calendarQuality: aggregateTradableWindow.calendarQuality,
      },
      researchUniverse,
      researchSchedulerActive: this.schedulerStarted,
      researchCadenceActive: Boolean(this.timer),
      researchCadence: {
        active: Boolean(this.timer),
        timerActive: Boolean(this.timer),
        nextScheduledCycleAt: this.nextScheduledCycleAt,
      },
      timerOwnership: {
        wakeTimerActive: Boolean(this.weeklyTimer),
        wakeScheduledFor: this.pendingWeeklyTransitionAt,
        wakeKind: this.pendingWeeklyTransitionKind,
        wakeSource: this.pendingWeeklyTransitionSource,
        wakeReason: this.pendingWeeklyTransitionReason,
        researchCadenceTimerActive: Boolean(this.timer),
        nextScheduledCycleAt: this.nextScheduledCycleAt,
        marketSnapshotTimerActive: marketSnapshotService.status().timerActive,
        memoryActiveTimers: activeTimers,
        memoryActiveTimersIncludes: ["weeklyResearchWake", "researchCadence"],
      },
      lastWeeklyTransition: this.lastWeeklyTransition,
      weeklyNotificationDeliveryState: this.lastWeeklyTransition,
      marketSnapshotScheduler: marketSnapshotService.status(),
      liveExecutionBlocked: true,
      deployedRevision: deploymentMetadata(this.env),
      liveMoneyExecution: this.config.liveExecutionEnabled ? "enabled_blocked_by_policy" : "blocked",
      demoBrokerExecution: this.config.demoBrokerExecutionEnabled ? "enabled_demo_only" : "disabled",
      paperExecution: this.config.paperExecutionEnabled ? "enabled" : "disabled",
      researchSignalCreation: this.config.researchSignalEnabled ? "enabled" : "disabled",
      telegramPublication: this.config.telegramSignalPublicationEnabled ? "enabled" : "disabled",
      orchestrationSafety: orchestrationSafetyStatus(this.config, this.configValidation, this.lastError),
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
      ranking: repositories.ranking,
      evidence: repositories.evidence,
    } : undefined, details, () => ({
      runtimeState: this.state,
      researchState: this.config.researchEnabled ? (this.config.pilotEnabled ? "idle" : "blocked") : "disabled",
      pilotState: this.config.pilotEnabled ? "configured" : null,
      paperExecutionState: this.config.paperExecutionEnabled ? "enabled" : "disabled",
      demoBrokerState: this.config.demoBrokerExecutionEnabled ? "enabled_demo_only" : "disabled",
      telegramPublicationState: this.config.telegramSignalPublicationEnabled ? "enabled" : "disabled",
      configurationState: this.configValidation.ok ? "complete" : "incomplete",
      runtimeConfiguration: {
        researchSignalEnabled: this.config.researchSignalEnabled,
        maxActiveResearchSignals: this.config.maxActiveResearchSignals,
        forwardTestingEnabled: this.config.forwardTestingEnabled,
        maxActiveForwardTests: this.config.maxActiveForwardTests,
        liveExecutionEnabled: this.config.liveExecutionEnabled,
        maxCyclesPerDay: this.config.maxCyclesPerDay,
        cycleTimeoutMs: this.config.cycleTimeoutMs,
        leaseTtlMs: this.config.leaseTtlMs,
        leaseRenewIntervalMs: this.config.leaseRenewIntervalMs,
        liveExecutionBlocked: true,
      },
      orchestrationSafety: orchestrationSafetyStatus(this.config, this.configValidation, this.lastError),
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

  private logSafetyStateSnapshot(reason: string) {
    emitSafetyStateSnapshot({
      runtimeInstanceId: this.bootId,
      reason,
      executionMode: this.config.liveExecutionEnabled ? "live_blocked" : this.config.demoBrokerExecutionEnabled ? "demo_broker" : this.config.paperExecutionEnabled ? "paper" : "research_only",
      killSwitchState: "inactive",
      dailyLossBreakerState: this.config.maxPaperDailyLoss > 0 ? "configured" : "disabled",
      brokerEnvironment: this.config.demoBrokerExecutionEnabled ? "demo" : "none",
      riskGateStatus: this.configValidation.ok && !this.config.liveExecutionEnabled ? "passing" : "blocked",
      liveExecutionBlocked: true,
      deployedRevision: deploymentMetadata(this.env),
    });
  }

  private async runResearchPath(input: { cycleId: string; cycleEventId: string; correlationId: string; now: Date; guard: CycleLeaseGuard }) {
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
    let forwardTestsCount = 0;
    let signalsCount = 0;
    let evaluationsCount = 0;
    let journalEntriesCount = 0;
    let lessonsCount = 0;
    let lifecycleDecisionsCount = 0;
    let evaluationsAttempted = 0;
    let evaluationsCompleted = 0;
    let observationsDeduplicated = 0;
    let hypothesesEvaluated = 0;
    let hypothesesBlocked = 0;
    const blockers: Array<Record<string, unknown>> = [];
    const rankingCandidates: RankingCandidateInput[] = [];
    const forwardTestSources = new Map<string, ForwardTestSource>();
    const semanticCandidates = new Map<string, ObservationSemanticGroup>();
    const candidateCausationIds = new Map<string, string>();
    const strategyCandidatesByFamily = new Map<string, number>();
    const strategyCandidatesBySymbol = new Map<string, number>();
    const marketDataCoverage = new Map<string, MarketDataCoverage>();
    const deferReasons: Record<string, string> = {};
    const cycleStartedAt = Date.now();

    const tradableResearchSymbols = marketSessionsService.instrumentSessions(this.config.symbols, input.now)
      .filter(session => session.status === "open" && resolveResearchInstrument(session.symbol))
      .map(session => session.symbol);
    const activeFxSession = activeFxResearchSession(input.now, tradableResearchSymbols);
    const prioritySymbols = activeFxSession?.prioritySymbols.length ? activeFxSession.prioritySymbols : activeFxSession?.compatibleConfiguredSymbols ?? [];
    const orderedResearchSymbols = prioritySymbols.length
      ? [...prioritySymbols, ...tradableResearchSymbols.filter((symbol) => !prioritySymbols.includes(symbol))]
      : tradableResearchSymbols;
    const theoreticalPlans = buildObservationPlan({ ...this.config, targetEvaluationsPerHour: Number.MAX_SAFE_INTEGER, maxObservationsPerCycle: Number.MAX_SAFE_INTEGER }, orderedResearchSymbols, input.cycleId);
    const plans = buildObservationPlan(this.config, orderedResearchSymbols, input.cycleId);
    const plannedKeys = new Set(plans.map(observationPlanKey));
    const cycleBudgetSkipped = theoreticalPlans.filter(plan => !plannedKeys.has(observationPlanKey(plan)));
    for (const plan of cycleBudgetSkipped) {
      await guarded(input.guard, "detector_evaluation_skipped", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol: plan.symbol, timeframe: plan.timeframe, detectorId: plan.detector.detectorId, detectorVersion: plan.detector.detectorVersion, strategyFamily: plan.detector.capability?.strategyFamily, status: "skipped", reason: "cycle_budget", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
    }
    const providerPlan = planProviderRequests(this.config, plans);
    for (const request of providerPlan.deferred) {
      deferReasons[request.symbol] = "provider_budget";
      for (const plan of request.plans) {
        await guarded(input.guard, "detector_evaluation_skipped", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol: plan.symbol, timeframe: plan.timeframe, detectorId: plan.detector.detectorId, detectorVersion: plan.detector.detectorVersion, strategyFamily: plan.detector.capability?.strategyFamily, status: "skipped", reason: "provider_budget", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
      }
    }
    const evaluatedSymbols = new Set<string>();
    const perSymbolLastEvaluatedAt: Record<string, string> = {};
    let providerRequestsExecuted = 0;
    for (const request of providerPlan.selected) {
      const { symbol, timeframe } = request;
      let candles: NormalizedCandle[];
      try {
        providerRequestsExecuted += this.config.researchDataMode === "provider" ? 1 : 0;
        candles = await researchCandles(this.config, this.env, symbol, timeframe, input.now, Math.max(80, ...request.plans.map(plan => plan.detector.capability?.requiredCandles ?? 0)));
      } catch (error) {
        const reason = sanitizedProviderFailureReason(error);
        blockers.push(blocker("warning", "research_market_data_unavailable", "observations", "Detector evaluation skipped because authoritative provider research data was unavailable.", symbol, "provider candles", "Restore the configured provider; do not substitute synthetic candles.", input.now));
        deferReasons[symbol] = reason;
        for (const plan of request.plans) {
          const { detector } = plan;
          evaluatedSymbols.add(symbol);
          perSymbolLastEvaluatedAt[symbol] = input.now.toISOString();
          const coverage = ensureCoverage(marketDataCoverage, symbol, timeframe, activeFxSession?.sessionId ?? "unknown", "unknown");
          coverage.requested += 1;
          evaluationsAttempted += 1;
          await guarded(input.guard, "detector_evaluation_attempted", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "attempted", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
          structuredLogger.v2({ level: "info", event: "detector_evaluation_started", message: "V2 detector evaluation started", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId, strategyFamily: detector.capability?.strategyFamily });
          await guarded(input.guard, "detector_evaluation_skipped", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: plan.detector.detectorId, detectorVersion: plan.detector.detectorVersion, strategyFamily: plan.detector.capability?.strategyFamily, status: "skipped", reason, correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
          structuredLogger.v2({ level: "warn", event: "detector_evaluation_skipped", message: "V2 detector evaluation skipped because authoritative market data is unavailable", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: plan.detector.detectorId, reason, ...(providerDiagnostic(error) ?? {}) });
        }
        continue;
      }
      const lastCandle = candles.at(-1)!;
      recordCoverageSuccess(marketDataCoverage, symbol, timeframe, activeFxSession?.sessionId ?? "unknown", lastCandle.source.provider, lastCandle.timestamp, input.now);
      if (!lastCandle.complete) {
        blockers.push(blocker("warning", "incomplete_candle_skipped", "observations", "Detector evaluation skipped because latest candle is incomplete.", false, true, "Wait for completed candle boundary.", input.now));
        for (const plan of request.plans) {
          const { detector } = plan;
          evaluatedSymbols.add(symbol);
          perSymbolLastEvaluatedAt[symbol] = input.now.toISOString();
          const coverage = ensureCoverage(marketDataCoverage, symbol, timeframe, activeFxSession?.sessionId ?? "unknown", "unknown");
          coverage.requested += 1;
          evaluationsAttempted += 1;
          await guarded(input.guard, "detector_evaluation_attempted", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "attempted", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
          structuredLogger.v2({ level: "info", event: "detector_evaluation_started", message: "V2 detector evaluation started", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId, strategyFamily: detector.capability?.strategyFamily });
          await guarded(input.guard, "detector_evaluation_skipped", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: plan.detector.detectorId, detectorVersion: plan.detector.detectorVersion, strategyFamily: plan.detector.capability?.strategyFamily, status: "skipped", reason: "incomplete_latest_candle", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
          structuredLogger.v2({ level: "warn", event: "detector_evaluation_skipped", message: "V2 detector evaluation skipped", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: plan.detector.detectorId, reason: "incomplete_latest_candle" });
        }
        continue;
      }
      const contextEventId = input.cycleEventId;
      const sourceDataIds = candles.slice(-40).map(candle => `${candle.source.provider}:${candle.symbol}:${candle.timeframe}:${candle.timestamp}`);
      const sourceDataHash = stableHash(candles.slice(-40).map(candle => ({ timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, spread: candle.spread, complete: candle.complete })));
      const metrics = metricsFromCandles(candles);
      const syntheticFixture = this.config.researchDataMode === "synthetic";
      const compressionDetected = syntheticFixture || Number(metrics.compressionRatio ?? 1) <= 0.7;
      const breakoutDetected = syntheticFixture || Number(metrics.breakoutDistance ?? 0) > Math.max(Number(metrics.atr ?? 0) * 0.1, 0.00001);
      const liquiditySweepDetected = syntheticFixture || detectLiquiditySweep(candles);
      for (const plan of request.plans) {
        const { detector } = plan;
        evaluatedSymbols.add(symbol);
        perSymbolLastEvaluatedAt[symbol] = input.now.toISOString();
        const coverage = ensureCoverage(marketDataCoverage, symbol, timeframe, activeFxSession?.sessionId ?? "unknown", "unknown");
        coverage.requested += 1;
        evaluationsAttempted += 1;
        await guarded(input.guard, "detector_evaluation_attempted", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "attempted", correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
        structuredLogger.v2({ level: "info", event: "detector_evaluation_started", message: "V2 detector evaluation started", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId, strategyFamily: detector.capability?.strategyFamily });
        evaluationsCompleted += 1;
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
            observationEvidence("chart", contextEventId, "volatility.compression", compressionDetected, lastCandle.timestamp, { symbol, timeframe, candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), marketDataSource: lastCandle.source.provider, sourceDataIds, sourceDataHash, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, detectorParameters: { requiredCandles: detector.capability?.requiredCandles ?? 0 } }),
            observationEvidence("chart", contextEventId, "structure.breakOfStructure", breakoutDetected, lastCandle.timestamp, { symbol, timeframe, candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), marketDataSource: lastCandle.source.provider, sourceDataIds, sourceDataHash, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, detectorParameters: { requiredCandles: detector.capability?.requiredCandles ?? 0 } }),
            observationEvidence("chart", contextEventId, "liquidity.sweep", liquiditySweepDetected, lastCandle.timestamp, { symbol, timeframe, candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), marketDataSource: lastCandle.source.provider, sourceDataIds, sourceDataHash, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, detectorParameters: { requiredCandles: detector.capability?.requiredCandles ?? 0 } }),
          ],
        });
        const compatible = obs.observations.filter(observation => observation.detectorId === detector.detectorId).slice(0, this.config.maxObservationsPerCycle - observationsCount);
        for (const observation of compatible) {
          const observationEventId = firstEventId(obs.events, "observations", observation.observationId);
          addSemanticCandidate(semanticCandidates, observation);
          candidateCausationIds.set(semanticGroupKey(semanticGroupFromObservation(observation)), observationEventId);
          const saved = await guarded(input.guard, "observation_save", () => repositories.observations.save(observation));
          if (!saved.inserted) {
            observationsDeduplicated += 1;
            const durableObservation = observationFromSaveResult(saved) ?? observation;
            addSemanticCandidate(semanticCandidates, durableObservation);
            await guarded(input.guard, "detector_evaluation_duplicate", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: observation.detectorId, detectorVersion: observation.detectorVersion, strategyFamily: observation.strategyFamily, status: "duplicate_suppressed", reason: "duplicate_suppressed", candleStart: observation.candleStart, candleEnd: observation.candleEnd, sourceDataHash: observation.sourceDataHash, correlationId: input.correlationId, causationId: itemEventCausation(input.cycleEventId), createdAt: input.now.toISOString() }));
            structuredLogger.v2({ level: "info", event: "observation_duplicate_suppressed", message: "Duplicate V2 observation suppressed", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: observation.detectorId, naturalKey: observation.naturalKey, semanticCandidateKey: semanticGroupKey(semanticGroupFromObservation(durableObservation)) });
            continue;
          }
          const durableObservation = observationFromSaveResult(saved) ?? observation;
          structuredLogger.v2({ level: "info", event: "observation_created", message: "V2 observation persisted", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: observation.detectorId, observationType: observation.observationType, confidence: observation.confidence, qualityScore: observation.qualityScore });
          addSemanticCandidate(semanticCandidates, durableObservation);
          observationsCount += 1;
        }
        await guarded(input.guard, "detector_evaluation_completed", () => saveDetectorEvaluation(repositories.operations, { cycleId: input.cycleId, symbol, timeframe, detectorId: detector.detectorId, detectorVersion: detector.detectorVersion, strategyFamily: detector.capability?.strategyFamily, status: "completed", candleStart: lastCandle.timestamp, candleEnd: nextCandleBoundary(lastCandle.timestamp, timeframe).toISOString(), sourceDataHash, correlationId: input.correlationId, causationId: input.cycleEventId, createdAt: input.now.toISOString() }));
        structuredLogger.v2({ level: "info", event: "detector_evaluation_completed", message: "V2 detector evaluation completed", cycleId: input.cycleId, correlationId: input.correlationId, symbol, timeframe, detectorId: detector.detectorId });
      }
    }
    const deferredSymbols = orderedResearchSymbols.filter(symbol => !evaluatedSymbols.has(symbol));
    for (const symbol of deferredSymbols) deferReasons[symbol] ??= "evaluation_budget_exhausted";
    const planning = {
      plannedEvaluations: theoreticalPlans.length,
      executedEvaluations: evaluationsAttempted,
      budgetExhausted: plans.length < theoreticalPlans.length,
      eligibleSymbols: orderedResearchSymbols,
      evaluatedSymbols: [...evaluatedSymbols],
      deferredSymbols,
      deferReasons,
      perSymbolLastEvaluatedAt,
      rolling24hSymbolCoverage: [...evaluatedSymbols].map(symbol => ({ symbol, evaluated: true, lastEvaluatedAt: perSymbolLastEvaluatedAt[symbol] ?? null })),
      coverageStarvationWarning: deferredSymbols.length > 0 ? "Some eligible symbols were deferred; deterministic rotation provides bounded future coverage." : null,
      resourceControl: {
        plannedDetectorEvaluations: theoreticalPlans.length,
        selectedDetectorEvaluations: plans.length,
        detectorEvaluationsDeferredByCycleBudget: cycleBudgetSkipped.length,
        plannedProviderRequests: providerPlan.plannedProviderRequests,
        selectedProviderRequests: providerPlan.selected.length,
        executedProviderRequests: providerRequestsExecuted,
        providerRequestsDeferredByBudget: providerPlan.deferred.length,
        affectedSymbolsTimeframes: providerPlan.deferred.map(item => ({ symbol: item.symbol, timeframe: item.timeframe, detectorEvaluations: item.plans.length })),
        remainingProviderBudget: providerPlan.remainingBudget,
      },
    };

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
      const instrument = resolveResearchInstrument(candidate.symbol);
      if (!instrument) {
        hypothesesBlocked += 1;
        blockers.push(blocker("critical", "hypothesis_symbol_unsupported", "hypothesis", "Candidate symbol is not in the canonical V2 research universe.", candidate.symbol, "validated research symbol", "Configure only supported research instruments.", input.now));
        continue;
      }
      const sessionId = researchSessionForCandidate(instrument, activeFxSession?.sessionId);
      const regime = classifyRegimeFromObservation(candidate.observationType);
      const hypothesis = hypotheses.generate({
          statement: `${candidate.symbol} ${candidate.timeframe} ${candidate.observationType} may have positive expectancy after costs.`,
          targetPopulation: { symbols: [candidate.symbol], assetClasses: [instrument.assetClass], timeframes: [candidate.timeframe], sessions: [sessionId], regimes: [regime] },
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
        const generatedHypothesis = hypothesis.hypothesis;
        const savedHypothesis = await guarded(input.guard, "hypothesis_save", () => repositories.hypotheses.save(generatedHypothesis));
        const persistedHypothesis = hypothesisFromSaveResult(savedHypothesis) ?? generatedHypothesis;
        if (!savedHypothesis.inserted) {
          structuredLogger.v2({ level: "info", event: "hypothesis_duplicate_suppressed", message: "Duplicate V2 hypothesis suppressed", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, hypothesisId: persistedHypothesis.hypothesisId, hypothesisFingerprint: persistedHypothesis.fingerprint, inserted: false, conflict: conflictFromSaveResult(savedHypothesis) ?? "idempotent", skipReason: "hypothesis_save_not_inserted" });
          continue;
        }
        const hypothesisEventId = firstEventId(hypothesis.events, "hypothesis", persistedHypothesis.hypothesisId);
        hypothesesCount += 1;
        structuredLogger.v2({ level: "info", event: "hypothesis_created", message: "V2 hypothesis persisted", cycleId: input.cycleId, correlationId: input.correlationId, ...commonPayload, hypothesisId: persistedHypothesis.hypothesisId, hypothesisFingerprint: persistedHypothesis.fingerprint, inserted: true, conflict: null });
        if (hypothesesCount > this.config.maxHypothesesPerCycle) break;
        const strategyInputs = instantiateStrategyTemplates({
          hypothesisId: persistedHypothesis.hypothesisId,
          symbol: candidate.symbol,
          timeframe: candidate.timeframe,
          observationType: candidate.observationType,
          detectorId: candidate.detectorId,
          detectorVersion: "observation-detector.v1",
          instrument,
          sessionId,
          regime,
          correlationId: input.correlationId,
          causationId: hypothesisEventId,
          createdAt: input.now.toISOString(),
          limits: {
            maxTemplatesPerSymbolSession: this.config.maxTemplatesPerSymbolSession,
            maxVariantsPerTemplate: this.config.maxVariantsPerTemplate,
          },
        });
        if (!strategyInputs.length) {
          blockers.push(blocker("warning", "no_compatible_strategy_template", "rules", "No enabled strategy template is compatible with the hypothesis symbol/session/regime/detector.", candidate.detectorId, "compatible template", "Add a deterministic template only when required evidence is available.", input.now));
          continue;
        }
        for (const strategyInput of strategyInputs) {
          const family = String(strategyInput.filters.find(rule => rule.field === "primaryFamily")?.value ?? "unknown");
          if ((strategyCandidatesByFamily.get(family) ?? 0) >= this.config.maxCandidatesPerFamilyPerCycle) continue;
          if ((strategyCandidatesBySymbol.get(candidate.symbol) ?? 0) >= this.config.maxCandidatesPerSymbolPerCycle) continue;
          const compiled = rulesV2Compiler.compile(strategyInput);
          if (!compiled.strategy) continue;
          const compiledStrategy = compiled.strategy;
          const strategyEventId = firstEventId(compiled.events, "rules", compiledStrategy.strategyId);
          await guarded(input.guard, "strategy_save", () => repositories.strategies.save(compiledStrategy));
          strategyCandidatesByFamily.set(family, (strategyCandidatesByFamily.get(family) ?? 0) + 1);
          strategyCandidatesBySymbol.set(candidate.symbol, (strategyCandidatesBySymbol.get(candidate.symbol) ?? 0) + 1);
          strategiesCount += 1;
          const experiment = experiments.create({
            hypothesisId: persistedHypothesis.hypothesisId,
            strategyId: compiled.strategy.strategyId,
            strategyVersion: compiled.strategy.strategyVersion,
            experimentType: "baseline_backtest",
            datasetSpecification: { symbols: [candidate.symbol], timeframes: [candidate.timeframe], start: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80)[0].timestamp, end: demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80).at(-1)!.timestamp },
            parameterSpecification: {
              grid: {
                templateId: [String(strategyInput.entryConditions.find(rule => rule.field === "templateId")?.value ?? "unknown")],
                parameterVariant: [String(strategyInput.entryConditions.find(rule => rule.field === "parameterVariant")?.value ?? "default")],
                family: [family],
                sessionId: [sessionId],
                regime: [regime],
              },
            },
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
          await guarded(input.guard, "experiment_save", () => repositories.experiments.save(experiment.experiment));
          experimentsCount += 1;
          const backtestCandles = demoCandles(candidate.symbol, normalizeTimeframe(candidate.timeframe), input.now, 80);
          const observationLineageEventId = candidateCausationIds.get(candidateKey) ?? input.cycleEventId;
          const backtest = backtestingV2Engine.run({ experimentId: experiment.experiment.experimentId, strategy: compiled.strategy, candles: backtestCandles, randomSeed: experiment.experiment.randomSeed, lineageEventIds: [observationLineageEventId, hypothesisEventId, strategyEventId, experimentEventId], correlationId: input.correlationId, causationId: experimentEventId, spread: 0.0002, commissionPerTrade: 0, slippage: 0.0001 });
          const backtestEventId = firstEventId(backtest.events, "backtesting", backtest.result.backtestId);
          await guarded(input.guard, "backtest_save", () => repositories.backtests.save(backtest.result));
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
          await guarded(input.guard, "courtroom_save", () => repositories.courtroom.save({ ...court.courtCase, lineageEventIds: [backtestEventId, experimentEventId, hypothesisEventId] }));
          verdictsCount += 1;
          const rankingCandidate = candidateFromBacktest(court.courtCase.caseId, court.courtCase.verdict, compiled.strategy.strategyId, compiled.strategy.strategyVersion, persistedHypothesis.hypothesisId, backtest.result, candidate.timeframe, courtEventId);
          rankingCandidates.push(rankingCandidate);
          forwardTestSources.set(rankingCandidateKey(rankingCandidate), { strategy: compiled.strategy, backtest: backtest.result, courtEventId });
          if (experimentsCount >= this.config.maxExperimentsPerCycle || backtestsCount >= this.config.maxBacktestsPerCycle) break;
        }
    }
    if (rankingCandidates.length) {
      const ranked = ranking.rank({ candidates: rankingCandidates, maxFocusedCount: 1, correlationId: input.correlationId, causationId: rankingCandidates[0].lineageEventIds.at(-1) ?? input.cycleEventId, generatedAt: new Date().toISOString() });
      const rankingEventId = firstEventId(ranked.events, "ranking", ranked.decision.rankingId);
      const rankingRecord = { ...ranked.decision, schemaVersion: "fincoach.v2.ranking.1" as const, lineageEventIds: rankingCandidates.flatMap(candidate => candidate.lineageEventIds) };
      const savedRanking = await guarded(input.guard, "ranking_save", () => repositories.ranking.save(rankingRecord));
      const persistedRanking = rankingFromSaveResult(savedRanking) ?? rankingRecord;
      if (!saveInserted(savedRanking)) {
        structuredLogger.v2({ level: "info", event: "ranking_duplicate_suppressed", message: "Duplicate V2 ranking suppressed", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: persistedRanking.rankingId, inserted: false, conflict: conflictFromSaveResult(savedRanking) ?? "idempotent", skipReason: "ranking_save_not_inserted" });
      } else {
        rankedCount = persistedRanking.candidates.length;
        forwardTestsCount = await createForwardTestsFromRanking({
          repositories,
          config: this.config,
          ranking: persistedRanking,
          rankingEventId,
          sources: forwardTestSources,
          cycleId: input.cycleId,
          correlationId: input.correlationId,
          now: input.now,
          guard: input.guard,
        });
      }
    }
    signalsCount = await createSignalsFromForwardTests({
      repositories,
      config: this.config,
      cycleId: input.cycleId,
      correlationId: input.correlationId,
      now: input.now,
      guard: input.guard,
    });
    evaluationsCount = await createEvaluationsFromSignals({ repositories, cycleId: input.cycleId, correlationId: input.correlationId, now: input.now, limit: artifactLimit(this.config), guard: input.guard });
    journalEntriesCount = await createJournalEntriesFromEvaluations({ repositories, cycleId: input.cycleId, correlationId: input.correlationId, now: input.now, limit: artifactLimit(this.config), guard: input.guard });
    lessonsCount = await createLessonsFromJournalEntries({ repositories, cycleId: input.cycleId, correlationId: input.correlationId, limit: artifactLimit(this.config), guard: input.guard });
    lifecycleDecisionsCount = await createLifecycleDecisionsFromLessons({ repositories, cycleId: input.cycleId, correlationId: input.correlationId, now: input.now, limit: artifactLimit(this.config), guard: input.guard });
    const completedEvent = blockers.length ? "pipeline_cycle_completed_with_blockers" : "pipeline_cycle_completed";
    structuredLogger.v2({ level: "info", event: completedEvent, message: "V2 research cycle lineage persisted", cycleId: input.cycleId, correlationId: input.correlationId, runtimeInstanceId: this.bootId, planning, evaluationsAttempted, evaluationsCompleted, observations: observationsCount, observationsDeduplicated, hypothesesEvaluated, hypotheses: hypothesesCount, hypothesesBlocked, strategies: strategiesCount, experiments: experimentsCount, backtests: backtestsCount, verdicts: verdictsCount, rankedCandidates: rankedCount, forwardTests: forwardTestsCount, signals: signalsCount, evaluations: evaluationsCount, journalEntries: journalEntriesCount, lessons: lessonsCount, lifecycleDecisions: lifecycleDecisionsCount, blockers });
    emitResearchCycleObserverSummaries({
      cycleId: input.cycleId,
      correlationId: input.correlationId,
      runtimeInstanceId: this.bootId,
      durationMs: Date.now() - cycleStartedAt,
      result: blockers.length ? "completed_with_blockers" : "completed",
      observationsAttempted: evaluationsAttempted,
      observationsCreated: observationsCount,
      observationsDeduplicated,
      hypothesesEvaluated,
      hypothesesCreated: hypothesesCount,
      experimentsRun: experimentsCount,
      backtestsCompleted: backtestsCount,
      rankedCandidates: rankedCount,
      forwardTestsStarted: forwardTestsCount,
      blockers,
      pipeline: {
        ingested: evaluationsCompleted,
        parsed: observationsCount + observationsDeduplicated,
        candidates: hypothesesEvaluated,
        riskApproved: rankedCount,
        riskRejected: hypothesesBlocked,
        executionRequested: 0,
        executionSucceeded: 0,
        executionFailed: 0,
        reconciled: lifecycleDecisionsCount,
        closed: 0,
      },
      marketDataCoverage: [...marketDataCoverage.values()],
      deployedRevision: deploymentMetadata(this.env),
    });
    v2TelemetryService.counter("v2_research_cycles_total", 1, { module: "orchestration", operation: "runOnce", resultClass: "success" });
    return { status: blockers.length ? "completed_with_blockers" : "completed", planning, evaluationsAttempted, evaluationsCompleted, observationsCreated: observationsCount, observationsDeduplicated, hypothesesEvaluated, hypothesesCreated: hypothesesCount, hypothesesBlocked, strategiesCreated: strategiesCount, experimentsQueued: experimentsCount, backtestsCompleted: backtestsCount, verdictsCreated: verdictsCount, rankedCandidates: rankedCount, forwardTestsCreated: forwardTestsCount, signalsCreated: signalsCount, evaluationsCreated: evaluationsCount, journalEntriesCreated: journalEntriesCount, lessonsCreated: lessonsCount, lifecycleDecisionsCreated: lifecycleDecisionsCount, lifecycleDecisions: lifecycleDecisionsCount, blockers, liveExecutionBlocked: true, telegramSignalsPublished: 0 };
  }

  private startCadence(initialRequestedBy: string) {
    if (this.schedulerStarted || this.timer) {
      structuredLogger.v2({ level: "info", event: "scheduler_duplicate_suppressed", message: "Duplicate V2 scheduler start suppressed", runtimeInstanceId: this.bootId, activeTimers: this.timer ? 1 : 0 });
      return;
    }
    this.schedulerStarted = true;
    this.state = "running";
    const schedule = () => {
      if (!this.schedulerStarted || this.state === "stopping" || this.state === "stopped" || this.state === "scheduled_closed" || this.state === "suspended_waiting_for_market" || this.state === "starting_for_week") return;
      this.nextScheduledCycleAt = new Date(Date.now() + this.config.cadenceMs).toISOString();
      structuredLogger.v2({ level: "info", event: "v2_cycle_scheduled", message: "Next V2 research cycle scheduled", runtimeInstanceId: this.bootId, nextScheduledCycleAt: this.nextScheduledCycleAt, cadenceMs: this.config.cadenceMs });
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runOnce({ requestedBy: "v2-autostart" }).finally(schedule);
      }, this.config.cadenceMs);
      this.timer.unref?.();
    };
    void this.runOnce({ requestedBy: initialRequestedBy }).finally(schedule);
  }

  private suspendCadence(reason: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextScheduledCycleAt = null;
    this.schedulerStarted = false;
    this.state = reason === "weekly_market_window_closed" ? "suspended_waiting_for_market" : "scheduled_closed";
    this.lastRunResult = { completed: false, reason, liveExecutionBlocked: true };
  }

  private async applyWeeklyWindow(trigger: string) {
    const window = weeklyResearchWindowState(this.config.weeklyResearchSchedule, new Date());
    const aggregate = marketSessionsService.aggregateTradableWindow(new Date());
    const insideLead = isInsideAggregateLead(this.config.weeklyResearchSchedule.startLeadMinutes, aggregate.nextTradableOpenAt, new Date());
    this.logWeeklyWindowState(window);
    this.logAggregateWindowState(aggregate);
    if (window.reason === "configuration_invalid" || aggregate.calendarQuality === "unavailable") {
      this.suspendCadence("weekly_schedule_configuration_invalid");
      this.state = aggregate.calendarQuality === "unavailable" ? "calendar_unavailable" : "configuration_blocked";
      this.scheduleWeeklyTimer(window);
      return;
    }
    if (aggregate.anyConfiguredInstrumentTradable) {
      this.state = "starting_for_week";
      const openBoundary = aggregate.openInstrumentSessions.map((session) => session.openedAt).filter(Boolean).sort()[0] ?? aggregate.nextTradableOpenAt;
      if (aggregate.anyConfiguredInstrumentTradable && openBoundary) {
        const result = await weeklyTransitionNotifier?.({ kind: "open", boundaryAt: openBoundary, window, aggregate }) ?? { skipped: true, reason: "weekly_transition_notifier_not_configured" };
        this.lastWeeklyTransition = { kind: "open", boundaryAt: openBoundary, delivery: result };
      }
      this.startCadence(trigger === "startup" ? "v2-weekly-startup" : "v2-weekly-open");
    } else if (insideLead) {
      this.suspendCadence("weekly_market_start_lead_waiting_for_open");
      this.state = "starting_for_week";
    } else {
      this.state = "stopping_for_week";
      if (trigger === "weekly_transition") {
        const boundaryAt = this.pendingWeeklyTransitionAt ?? aggregate.finalWeeklyCloseAt ?? previousCloseBoundary(window);
        const result = await weeklyTransitionNotifier?.({ kind: "close", boundaryAt, window, aggregate }) ?? { skipped: true, reason: "weekly_transition_notifier_not_configured" };
        this.lastWeeklyTransition = { kind: "close", boundaryAt, delivery: result };
      }
      this.suspendCadence("weekly_market_window_closed");
    }
    this.scheduleWeeklyTimer(window);
  }

  private scheduleWeeklyTimer(window: WeeklyResearchWindowState) {
    if (this.weeklyTimer) clearTimeout(this.weeklyTimer);
    const aggregate = marketSessionsService.aggregateTradableWindow(new Date());
    const now = new Date();
    const target = nextWeeklyWakeTarget({
      aggregate,
      configuredWeeklyCloseAt: window.currentWindowClosesAt ?? window.nextWindowClosesAt,
      startLeadMinutes: this.config.weeklyResearchSchedule.startLeadMinutes,
      now,
    });
    const next = target?.at ?? null;
    if (!next) {
      this.pendingWeeklyTransitionAt = null;
      this.pendingWeeklyTransitionKind = null;
      this.pendingWeeklyTransitionSource = null;
      this.pendingWeeklyTransitionReason = null;
      return;
    }
    this.pendingWeeklyTransitionAt = next;
    this.pendingWeeklyTransitionKind = target?.kind ?? null;
    this.pendingWeeklyTransitionSource = target?.source ?? null;
    this.pendingWeeklyTransitionReason = target?.reason ?? null;
    const delay = Math.max(1_000, Math.min(Date.parse(next) - now.getTime(), 2_147_000_000));
    this.weeklyTimer = setTimeout(() => {
      this.weeklyTimer = null;
      void this.applyWeeklyWindow("weekly_transition");
    }, delay);
    this.weeklyTimer.unref?.();
    structuredLogger.v2({ level: "info", event: "weekly_research_transition_scheduled", message: "Next weekly research transition scheduled", runtimeInstanceId: this.bootId, nextTransitionAt: next, transitionKind: this.pendingWeeklyTransitionKind, transitionSource: this.pendingWeeklyTransitionSource, transitionReason: this.pendingWeeklyTransitionReason, activeTimers: (this.timer ? 1 : 0) + 1, reason: window.reason });
  }

  private logWeeklyWindowState(window: WeeklyResearchWindowState) {
    if (this.lastWeeklyWindowReason === window.reason) return;
    this.lastWeeklyWindowReason = window.reason;
    structuredLogger.v2({ level: "info", event: "weekly_research_window_state_changed", message: "Weekly research window state changed", runtimeInstanceId: this.bootId, weeklyWindow: window, liveExecutionBlocked: true });
  }

  private logAggregateWindowState(window: AggregateTradableWindow) {
    const reason = `${window.anyConfiguredInstrumentTradable}:${window.finalWeeklyCloseAt}:${window.nextTradableOpenAt}:${window.calendarQuality}`;
    if (this.lastWeeklyWindowReason === reason) return;
    this.lastWeeklyWindowReason = reason;
    structuredLogger.v2({ level: "info", event: "aggregate_tradable_window_state_changed", message: "Aggregate tradable window state changed", runtimeInstanceId: this.bootId, aggregateTradableWindow: window, liveExecutionBlocked: true });
  }
}

function previousCloseBoundary(window: WeeklyResearchWindowState) {
  return window.currentWindowClosesAt ?? window.nextWindowClosesAt;
}

function isInsideAggregateLead(minutes: number, nextOpenAt: string | null, now: Date) {
  if (!nextOpenAt || minutes <= 0) return false;
  const delta = Date.parse(nextOpenAt) - now.getTime();
  return delta > 0 && delta <= minutes * 60_000;
}

function nextWeeklyWakeTarget(input: { aggregate: AggregateTradableWindow; configuredWeeklyCloseAt: string | null; startLeadMinutes: number; now: Date }): { at: string; kind: "lead" | "open" | "close"; source: string; reason: string } | null {
  if (input.aggregate.anyConfiguredInstrumentTradable) {
    if (input.aggregate.finalWeeklyCloseAt) {
      return {
        at: input.aggregate.finalWeeklyCloseAt,
        kind: "close",
        source: "aggregate_final_tradable_close",
        reason: input.configuredWeeklyCloseAt && input.configuredWeeklyCloseAt !== input.aggregate.finalWeeklyCloseAt
          ? "using_last_configured_instrument_close_before_weekly_fallback"
          : "using_aggregate_final_tradable_close",
      };
    }
    return input.configuredWeeklyCloseAt ? { at: input.configuredWeeklyCloseAt, kind: "close", source: "configured_weekly_close_fallback", reason: "aggregate_close_unavailable" } : null;
  }
  if (!input.aggregate.nextTradableOpenAt) return null;
  const openMs = Date.parse(input.aggregate.nextTradableOpenAt);
  const leadMs = openMs - Math.max(0, input.startLeadMinutes) * 60_000;
  if (input.startLeadMinutes > 0 && leadMs > input.now.getTime()) {
    return { at: new Date(leadMs).toISOString(), kind: "lead", source: "aggregate_next_tradable_open_lead", reason: "wake_before_open_without_admitting_research" };
  }
  return { at: input.aggregate.nextTradableOpenAt, kind: "open", source: "aggregate_next_tradable_open", reason: "wake_at_actual_tradable_open" };
}

export function createFinCoachV2Runtime(env: NodeJS.ProcessEnv = process.env) {
  return new FinCoachV2Runtime(env);
}

export function configureWeeklyTransitionNotifier(notifier: WeeklyTransitionNotifier | null) {
  weeklyTransitionNotifier = notifier;
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

function orchestrationSafetyStatus(config: V2RuntimeConfig, validation: V2RuntimeConfigValidation, lastError: string | null) {
  const blockers = new Set<string>();
  if (!validation.ok) blockers.add("invalid_orchestration_configuration");
  for (const error of validation.errors) {
    if (/LEASE|CYCLE|MAX_CYCLES|DATABASE_URL|Autostart|runtime|Research|Pilot/i.test(error)) blockers.add("invalid_orchestration_configuration");
  }
  if (lastError === "daily_limit_reached") blockers.add("daily_limit_reached");
  if (lastError === "runtime_lease_unavailable") blockers.add("lease_held");
  if (lastError === "lease_lost") blockers.add("lease_lost");
  if (lastError === "cycle_timeout") blockers.add("cycle_timed_out");
  if (lastError === "stale_cycle_recovered") blockers.add("stale_cycle_recovered");
  return {
    schemaVersion: "fincoach.v2.orchestration-safety.1",
    admissionTimezone: "UTC",
    maxCyclesPerUtcDay: config.maxCyclesPerDay,
    cycleTimeoutMs: config.cycleTimeoutMs,
    leaseTtlMs: config.leaseTtlMs,
    leaseRenewIntervalMs: config.leaseRenewIntervalMs,
    liveExecutionBlocked: true,
    blockers: [...blockers].sort(),
  };
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

function ensureCoverage(map: Map<string, MarketDataCoverage>, symbol: string, timeframe: string, session: string, provider: string) {
  const key = `${symbol}:${timeframe}`;
  const existing = map.get(key);
  if (existing) return existing;
  const created: MarketDataCoverage = {
    symbol,
    timeframe,
    session,
    provider,
    requested: 0,
    successful: 0,
    latestTimestamp: null,
    freshnessSeconds: null,
    stale: false,
  };
  map.set(key, created);
  return created;
}

function recordCoverageSuccess(map: Map<string, MarketDataCoverage>, symbol: string, timeframe: string, session: string, provider: string, latestTimestamp: string, now: Date) {
  const coverage = ensureCoverage(map, symbol, timeframe, session, provider);
  coverage.session = session;
  coverage.provider = provider;
  coverage.successful += 1;
  if (!coverage.latestTimestamp || latestTimestamp > coverage.latestTimestamp) coverage.latestTimestamp = latestTimestamp;
  const freshnessSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(latestTimestamp)) / 1000));
  coverage.freshnessSeconds = coverage.freshnessSeconds === null ? freshnessSeconds : Math.min(coverage.freshnessSeconds, freshnessSeconds);
  coverage.stale = freshnessSeconds > 24 * 60 * 60;
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

const COMPLETED_CANDLE_FETCH_BUFFER = 2;

export async function researchCandles(config: V2RuntimeConfig, env: NodeJS.ProcessEnv, symbol: string, timeframe: V2Timeframe, now: Date, count: number): Promise<NormalizedCandle[]> {
  if (config.researchDataMode === "synthetic") return demoCandles(symbol, timeframe, now, count);
  const token = env["OANDA_API_TOKEN"]?.trim();
  if (!token) throw new Error("OANDA_API_TOKEN is not configured");
  const baseUrl = (env["OANDA_BASE_URL"]?.trim() || `https://api-fx${env["OANDA_ENV"] === "live" ? "trade" : "practice"}.oanda.com`).replace(/\/$/, "");
  const granularity = ({ "1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "3h": "H3", "4h": "H4", "6h": "H6", "1d": "D", "1w": "W", "1mo": "M" } as Record<V2Timeframe, string>)[timeframe];
  if (!granularity) throw new Error("Unsupported OANDA timeframe");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const requestedCount = Math.min(count + COMPLETED_CANDLE_FETCH_BUFFER, 5000);
  const response = await fetch(`${baseUrl}/v3/instruments/${encodeURIComponent(symbol)}/candles?count=${requestedCount}&granularity=${granularity}&price=M`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`OANDA historical candles failed with HTTP ${response.status}`);
  const payload = await response.json() as { candles?: Array<{ time: string; complete?: boolean; mid?: { o: string; h: string; l: string; c: string }; volume?: number }> };
  const rawCandles = payload.candles ?? [];
  const candles = rawCandles.map(candle => {
    if (!candle.mid) throw new Error("OANDA candle missing mid prices");
    return { symbol, timeframe, timestamp: new Date(candle.time).toISOString(), open: Number(candle.mid.o), high: Number(candle.mid.h), low: Number(candle.mid.l), close: Number(candle.mid.c), spread: null, volume: candle.volume ?? null, tickVolume: candle.volume ?? null, complete: candle.complete !== false, source: { provider: "oanda-practice-historical", providerSymbol: symbol, adapterVersion: "v1" }, corporateAction: null };
  });
  if (!candles.every(candle => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))) throw new Error("OANDA returned invalid candles");
  const completedCandles = candles.filter(candle => candle.complete);
  if (completedCandles.length < count) {
    throw new InsufficientCompletedCandlesError({ symbol, timeframe, requestedCount, returnedCount: rawCandles.length, completedCount: completedCandles.length, requiredCount: count, providerGranularity: granularity });
  }
  return completedCandles.slice(-count);
}

class InsufficientCompletedCandlesError extends Error {
  readonly diagnostic: ProviderCandleDiagnostic;

  constructor(diagnostic: ProviderCandleDiagnostic) {
    super(`OANDA returned insufficient completed candles: returned=${diagnostic.returnedCount} completed=${diagnostic.completedCount} required=${diagnostic.requiredCount}`);
    this.name = "InsufficientCompletedCandlesError";
    this.diagnostic = diagnostic;
  }
}

type ProviderCandleDiagnostic = {
  symbol: string;
  timeframe: string;
  requestedCount: number;
  returnedCount: number;
  completedCount: number;
  requiredCount: number;
  providerGranularity: string;
};

function providerDiagnostic(error: unknown): ProviderCandleDiagnostic | null {
  return error instanceof InsufficientCompletedCandlesError ? error.diagnostic : null;
}

export function configuredObservationDetectors() {
  return [compressionDetector, breakoutDetector, liquiditySweepDetector].filter(detector => detector.capability?.enabled !== false);
}

export function buildObservationPlan(config: V2RuntimeConfig, symbols = config.symbols, rotationKey = "static") {
  const detectors = configuredObservationDetectors();
  const perSymbol = symbols.map(symbol => ({ symbol, plans: [] as Array<{ symbol: string; timeframe: V2Timeframe; detector: typeof detectors[number] }> }));
  for (const entry of perSymbol) {
    const symbol = entry.symbol;
    if (!resolveResearchInstrument(symbol)) continue;
    for (const timeframe of config.timeframes.map(normalizeTimeframe)) {
      for (const detector of detectors) {
        if (!detector.capability?.supportedTimeframes.includes(timeframe)) continue;
        entry.plans.push({ symbol, timeframe, detector });
      }
    }
  }
  const budget = Math.max(config.targetEvaluationsPerHour, config.maxObservationsPerCycle);
  const rotation = perSymbol.length ? Number.parseInt(createHash("sha256").update(rotationKey).digest("hex").slice(0, 8), 16) % perSymbol.length : 0;
  const ordered = perSymbol.slice(rotation).concat(perSymbol.slice(0, rotation));
  const plans: Array<{ symbol: string; timeframe: V2Timeframe; detector: typeof detectors[number] }> = [];
  let depth = 0;
  while (plans.length < budget && ordered.some(entry => entry.plans[depth])) {
    for (const entry of ordered) {
      const plan = entry.plans[depth];
      if (plan && plans.length < budget) plans.push(plan);
    }
    depth += 1;
  }
  return plans;
}

type ObservationPlan = ReturnType<typeof buildObservationPlan>[number];

export function planProviderRequests(config: Pick<V2RuntimeConfig, "researchDataMode" | "providerCallBudget">, plans: ObservationPlan[]) {
  const grouped = new Map<string, { symbol: string; timeframe: V2Timeframe; plans: ObservationPlan[] }>();
  for (const plan of plans) {
    const key = providerRequestKey(plan.symbol, plan.timeframe);
    const group = grouped.get(key) ?? { symbol: plan.symbol, timeframe: plan.timeframe, plans: [] };
    group.plans.push(plan);
    grouped.set(key, group);
  }
  const requests = interleaveProviderRequests([...grouped.values()]);
  if (config.researchDataMode !== "provider") {
    return { plannedProviderRequests: 0, selected: requests, deferred: [] as typeof requests, remainingBudget: 0 };
  }
  const budget = Math.max(0, config.providerCallBudget);
  return {
    plannedProviderRequests: requests.length,
    selected: requests.slice(0, budget),
    deferred: requests.slice(budget),
    remainingBudget: Math.max(0, budget - Math.min(budget, requests.length)),
  };
}

function interleaveProviderRequests<T extends { timeframe: V2Timeframe }>(requests: T[]) {
  const byTimeframe = new Map<V2Timeframe, T[]>();
  for (const request of requests) {
    const group = byTimeframe.get(request.timeframe) ?? [];
    group.push(request);
    byTimeframe.set(request.timeframe, group);
  }
  const timeframes = [...byTimeframe.keys()];
  const interleaved: T[] = [];
  let depth = 0;
  while (timeframes.some(timeframe => byTimeframe.get(timeframe)?.[depth])) {
    for (const timeframe of timeframes) {
      const request = byTimeframe.get(timeframe)?.[depth];
      if (request) interleaved.push(request);
    }
    depth += 1;
  }
  return interleaved;
}

function observationPlanKey(plan: ObservationPlan) {
  return `${plan.symbol}:${plan.timeframe}:${plan.detector.detectorId}`;
}

function providerRequestKey(symbol: string, timeframe: V2Timeframe) {
  return `${symbol}:${timeframe}`;
}

export function sanitizedProviderFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401\b/.test(message)) return "provider_http_401";
  if (/HTTP 403\b/.test(message)) return "provider_http_403";
  if (/HTTP 429\b/.test(message)) return "provider_http_429";
  if (/HTTP 5\d\d\b/.test(message)) return "provider_http_5xx";
  if (/abort|timeout/i.test(message) || (error instanceof Error && error.name === "AbortError")) return "provider_timeout";
  if (/insufficient.*completed|completed.*insufficient/i.test(message)) return "insufficient_completed_candles";
  if (/insufficient/i.test(message)) return "insufficient_completed_candles";
  if (/invalid|missing mid|non-finite/i.test(message)) return "invalid_candles";
  if (/unsupported.*timeframe|granularity/i.test(message)) return "unsupported_timeframe";
  if (/fetch|network|econn|enotfound|eai_again|socket/i.test(message)) return "provider_network";
  return "market_data_unavailable";
}

function addSemanticCandidate(candidates: Map<string, ObservationSemanticGroup>, observation: MarketObservation) {
  const group = semanticGroupFromObservation(observation);
  candidates.set(semanticGroupKey(group), group);
}

function hypothesisCandidateScanLimit(config: V2RuntimeConfig) {
  return Math.max(config.maxHypothesesPerCycle * 4, config.minIndependentHypothesisOccurrences * 4, 20);
}

function researchSessionForCandidate(instrument: { assetClass: string; sessionGroup: "fx" | "commodities" }, activeFxSessionId?: FxResearchSessionId): FxResearchSessionId | "fx" | "commodities" {
  return instrument.assetClass === "forex" && activeFxSessionId ? activeFxSessionId : instrument.sessionGroup;
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

function rankingFromSaveResult(saved: unknown): (StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] }) | null {
  const result = saved as { record?: StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] }; ranking?: StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] }; existing?: StrategyRankingDecision & { schemaVersion: "fincoach.v2.ranking.1"; lineageEventIds: string[] } };
  return result.record ?? result.ranking ?? result.existing ?? null;
}

function forwardTestFromSaveResult(saved: unknown): ForwardTestRecord | null {
  const result = saved as { record?: ForwardTestRecord; forwardTest?: ForwardTestRecord; existing?: ForwardTestRecord };
  return result.record ?? result.forwardTest ?? result.existing ?? null;
}

function signalFromSaveResult(saved: unknown): V2ResearchSignal | null {
  const result = saved as { record?: V2ResearchSignal; signal?: V2ResearchSignal; existing?: V2ResearchSignal };
  return result.record ?? result.signal ?? result.existing ?? null;
}

function saveInserted(saved: unknown) {
  return (saved as { inserted?: boolean }).inserted === true;
}

function conflictFromSaveResult(saved: unknown) {
  return (saved as { conflict?: string }).conflict;
}

type ForwardTestSource = { strategy: StrategyDefinition; backtest: BacktestResult; courtEventId: string };

type ForwardTestRepositoryLike = {
  save(record: ForwardTestRecord): Promise<unknown> | unknown;
};

export async function createForwardTestsFromRanking(input: {
  repositories: { forwardTesting?: ForwardTestRepositoryLike };
  config: Pick<V2RuntimeConfig, "forwardTestingEnabled" | "maxActiveForwardTests">;
  ranking: StrategyRankingDecision & { schemaVersion?: "fincoach.v2.ranking.1"; lineageEventIds?: string[] };
  rankingEventId: string;
  sources: Map<string, ForwardTestSource>;
  cycleId: string;
  correlationId: string;
  now: Date;
  guard?: CycleLeaseGuard;
}) {
  if (!input.config.forwardTestingEnabled) {
    structuredLogger.v2({ level: "info", event: "forward_test_creation_skipped", message: "V2 forward-test creation skipped", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, reason: "forward_testing_disabled" });
    return 0;
  }
  const limit = input.config.maxActiveForwardTests;
  if (limit <= 0) {
    structuredLogger.v2({ level: "info", event: "forward_test_creation_skipped", message: "V2 forward-test creation skipped", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, reason: "forward_test_budget_zero" });
    return 0;
  }
  const repository = input.repositories.forwardTesting;
  if (!repository || typeof repository.save !== "function") {
    structuredLogger.v2({ level: "error", event: "forward_test_persistence_unavailable", message: "V2 forward-test repository is unavailable", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId });
    return 0;
  }

  const service = new ForwardTestingV2Service();
  let inserted = 0;
  for (const candidate of input.ranking.candidates) {
    if (inserted >= limit) {
      structuredLogger.v2({ level: "info", event: "forward_test_budget_exhausted", message: "V2 forward-test insertion budget exhausted", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, limit });
      break;
    }
    const source = input.sources.get(rankingCandidateKey(candidate));
    if (!source) {
      structuredLogger.v2({ level: "warn", event: "forward_test_candidate_skipped", message: "V2 forward-test candidate skipped", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, strategyId: candidate.strategyId, strategyVersion: candidate.strategyVersion, courtCaseId: candidate.courtCaseId, reason: "current_cycle_source_missing" });
      continue;
    }
    const snapshot = forwardSnapshot(input.ranking.rankingId, candidate, source, input.rankingEventId);
    const lineageEventIds = [...new Set([...candidate.lineageEventIds, input.rankingEventId])];
    const created = service.create({
      strategy: source.strategy,
      courtCaseId: candidate.courtCaseId,
      courtVerdict: candidate.courtVerdict,
      rankingId: input.ranking.rankingId,
      snapshot,
      demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: input.now.toISOString() },
      killSwitchActive: false,
      reason: candidate.reasons.length ? candidate.reasons.join(",") : "ranked candidate selected for demo forward testing",
      counterargument: "Forward-test performance may diverge from deterministic replay evidence.",
      expectedR: candidate.metrics.oosExpectancy,
      risk: source.strategy.positionSizing.riskFraction,
      lineageEventIds,
      correlationId: input.correlationId,
      causationId: input.rankingEventId,
    });
    if (!created.record) {
      const reason = created.events[0]?.payload && typeof created.events[0].payload === "object" ? (created.events[0].payload as { reason?: string }).reason : "forward_test_gate_blocked";
      const verdictEligibility = forwardTestVerdictEligibility(candidate.courtVerdict);
      structuredLogger.v2({ level: "info", event: "forward_test_candidate_rejected", message: "V2 forward-test candidate rejected", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, strategyId: candidate.strategyId, strategyVersion: candidate.strategyVersion, courtCaseId: candidate.courtCaseId, verdict: candidate.courtVerdict, normalizedEligibilityResult: verdictEligibility, reason });
      continue;
    }
    try {
      const saved = await guarded(input.guard, "forward_test_save", () => repository.save(created.record!));
      const persisted = forwardTestFromSaveResult(saved) ?? created.record;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "forward_test_duplicate_suppressed", message: "Duplicate V2 forward test suppressed", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, forwardTestId: persisted.forwardTestId, strategyId: candidate.strategyId, strategyVersion: candidate.strategyVersion, courtCaseId: candidate.courtCaseId, inserted: false, conflict: conflictFromSaveResult(saved) ?? "idempotent", skipReason: "forward_test_save_not_inserted" });
        continue;
      }
      inserted += 1;
      structuredLogger.v2({ level: "info", event: "forward_test_created", message: "V2 forward test persisted", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, forwardTestId: persisted.forwardTestId, strategyId: candidate.strategyId, strategyVersion: candidate.strategyVersion, courtCaseId: candidate.courtCaseId, inserted: true });
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "forward_test_persistence_failed", message: "V2 forward-test persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, rankingId: input.ranking.rankingId, strategyId: candidate.strategyId, strategyVersion: candidate.strategyVersion, courtCaseId: candidate.courtCaseId, error });
      continue;
    }
  }
  return inserted;
}

function rankingCandidateKey(candidate: Pick<RankingCandidateInput, "strategyId" | "strategyVersion" | "courtCaseId">) {
  return `${candidate.strategyId}:${candidate.strategyVersion}:${candidate.courtCaseId}`;
}

function forwardSnapshot(rankingId: string, candidate: RankingCandidateInput, source: ForwardTestSource, rankingEventId: string) {
  const symbol = source.strategy.symbols[0] ?? "EUR_USD";
  const price = Math.max(0.000001, Number((1 + Math.max(-0.5, Math.min(0.5, candidate.rawReturn / 100))).toFixed(6)));
  return {
    snapshotId: `forward-snapshot:${rankingId}:${candidate.strategyId}:${candidate.strategyVersion}:${candidate.courtCaseId}`,
    symbol,
    timestamp: source.backtest.createdAt,
    bid: price,
    ask: Number((price + 0.0002).toFixed(6)),
    spread: 0.0002,
    fresh: true,
    contextEventId: rankingEventId,
    lineageEventIds: [...new Set([...candidate.lineageEventIds, rankingEventId])],
  };
}

type ForwardTestingSignalSourceRepositoryLike = {
  eligibleForSignal?(input: { now: Date; limit: number }): Promise<ForwardTestRecord[]> | ForwardTestRecord[];
};

type SignalRepositoryLike = {
  save(record: V2ResearchSignal): Promise<unknown> | unknown;
  listPage?(input?: { limit?: number; offset?: number }): Promise<{ total: number }> | { total: number };
};

export async function createSignalsFromForwardTests(input: {
  repositories: { forwardTesting?: ForwardTestingSignalSourceRepositoryLike; signals?: SignalRepositoryLike };
  config: Pick<V2RuntimeConfig, "researchSignalEnabled" | "maxActiveResearchSignals">;
  cycleId: string;
  correlationId: string;
  now: Date;
  guard?: CycleLeaseGuard;
}) {
  if (!input.config.researchSignalEnabled) {
    structuredLogger.v2({ level: "info", event: "signal_creation_skipped", message: "V2 signal creation skipped", cycleId: input.cycleId, correlationId: input.correlationId, reason: "research_signal_disabled" });
    return 0;
  }
  const limit = input.config.maxActiveResearchSignals;
  if (limit <= 0) {
    structuredLogger.v2({ level: "info", event: "signal_creation_skipped", message: "V2 signal creation skipped", cycleId: input.cycleId, correlationId: input.correlationId, reason: "active_signal_limit_zero" });
    return 0;
  }
  const sourceRepository = input.repositories.forwardTesting;
  const signalRepository = input.repositories.signals;
  if (!sourceRepository || typeof sourceRepository.eligibleForSignal !== "function") {
    structuredLogger.v2({ level: "error", event: "signal_source_unavailable", message: "V2 signal source repository is unavailable", cycleId: input.cycleId, correlationId: input.correlationId });
    return 0;
  }
  if (!signalRepository || typeof signalRepository.save !== "function") {
    structuredLogger.v2({ level: "error", event: "signal_persistence_unavailable", message: "V2 signal repository is unavailable", cycleId: input.cycleId, correlationId: input.correlationId });
    return 0;
  }
  const activeSignals = signalRepository.listPage ? Number((await signalRepository.listPage({ limit: 1, offset: 0 })).total ?? 0) : 0;
  if (activeSignals >= limit) {
    structuredLogger.v2({ level: "info", event: "signal_active_limit_reached", message: "V2 active signal limit reached", cycleId: input.cycleId, correlationId: input.correlationId, activeSignals, limit });
    return 0;
  }

  const forwardTests = await sourceRepository.eligibleForSignal({ now: input.now, limit: signalCandidateScanLimit(input.config) });
  const service = new SignalsV2Service();
  let inserted = 0;
  for (const forwardTest of forwardTests) {
    const eligibility = evaluateSignalEligibility(forwardTest, { now: input.now });
    structuredLogger.v2({ level: "info", event: "signal_candidate_evaluated", message: "V2 signal candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, forwardTestStatus: forwardTest.status, eligibility });
    if (!eligibility.eligible) {
      structuredLogger.v2({ level: "info", event: "signal_candidate_rejected", message: "V2 signal candidate rejected", cycleId: input.cycleId, correlationId: input.correlationId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, forwardTestStatus: forwardTest.status, eligibility, reason: eligibility.reason });
      continue;
    }
    if (activeSignals + inserted >= limit) {
      structuredLogger.v2({ level: "info", event: "signal_cycle_budget_reached", message: "V2 signal insertion budget reached", cycleId: input.cycleId, correlationId: input.correlationId, activeSignals, inserted, limit });
      break;
    }
    const request = signalRequestFromForwardTest(forwardTest, input.now);
    const published = service.publish(request);
    if (!published.signal) {
      const reason = published.events[0]?.payload && typeof published.events[0].payload === "object" ? (published.events[0].payload as { reason?: string }).reason : "signal_safety_check_failed";
      structuredLogger.v2({ level: "info", event: "signal_candidate_rejected", message: "V2 signal candidate rejected by service", cycleId: input.cycleId, correlationId: input.correlationId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, forwardTestStatus: forwardTest.status, eligibility, reason });
      continue;
    }
    try {
      const saved = await guarded(input.guard, "signal_save", () => signalRepository.save(published.signal!));
      const persisted = signalFromSaveResult(saved) ?? published.signal;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "signal_duplicate_suppressed", message: "Duplicate V2 signal suppressed", cycleId: input.cycleId, correlationId: input.correlationId, signalId: persisted.signalId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, inserted: false, conflict: conflictFromSaveResult(saved) ?? "idempotent", skipReason: "signal_save_not_inserted" });
        continue;
      }
      inserted += 1;
      structuredLogger.v2({ level: "info", event: "signal_inserted", message: "V2 research signal persisted", cycleId: input.cycleId, correlationId: input.correlationId, signalId: persisted.signalId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, inserted: true });
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "signal_persistence_failed", message: "V2 signal persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, forwardTestId: forwardTest.forwardTestId, rankingId: forwardTest.rankingId, error });
      continue;
    }
  }
  return inserted;
}

function signalCandidateScanLimit(config: Pick<V2RuntimeConfig, "maxActiveResearchSignals">) {
  return Math.max(config.maxActiveResearchSignals * 4, 20);
}

function signalRequestFromForwardTest(forwardTest: ForwardTestRecord, now: Date) {
  const side = "buy" as const;
  const entryPrice = Number(forwardTest.snapshot.ask.toFixed(6));
  const riskDistance = Math.max(forwardTest.snapshot.spread * 10, entryPrice * Math.max(forwardTest.risk, 0.0005));
  return {
    symbol: forwardTest.snapshot.symbol,
    side,
    entryPrice,
    stopLoss: Number((entryPrice - riskDistance).toFixed(6)),
    takeProfit: Number((entryPrice + riskDistance * Math.max(1.5, forwardTest.expectedR > 0 ? forwardTest.expectedR : 1.5)).toFixed(6)),
    timeframe: "1m",
    strategyId: forwardTest.strategyId,
    strategyVersion: forwardTest.strategyVersion,
    courtCaseId: forwardTest.courtCaseId,
    forwardTestId: forwardTest.forwardTestId,
    confidence: Math.max(0, Math.min(1, 0.5 + Math.min(forwardTest.expectedR, 1) / 2)),
    evidenceScore: Math.max(0, Math.min(1, 0.7 + Math.min(forwardTest.expectedR, 0.3))),
    validUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
    demoOnly: true as const,
    lineageEventIds: [...new Set([...forwardTest.lineageEventIds, forwardTest.forwardTestId])],
    correlationId: forwardTest.correlationId,
    causationId: forwardTest.causationId,
    killSwitchActive: false,
    marketSnapshotFresh: forwardTest.snapshot.fresh,
    forwardTestStatus: forwardTest.status,
    createdAt: now.toISOString(),
  };
}

type SignalSourceRepositoryLike = { eligibleForEvaluation?(input: { now: Date; limit: number }): Promise<V2ResearchSignal[]> | V2ResearchSignal[] };
type EvaluationRepositoryLike = { saveEvaluation(record: ExternalEvaluation): Promise<unknown> | unknown; eligibleForJournal?(input: { limit: number }): Promise<ExternalEvaluation[]> | ExternalEvaluation[] };
type JournalRepositoryLike = { append(record: ResearchJournalEntry): Promise<unknown> | unknown; eligibleForLesson?(input: { limit: number }): Promise<ResearchJournalEntry[]> | ResearchJournalEntry[] };
type LearningRepositoryLike = { saveLesson(record: LearningLesson): Promise<unknown> | unknown; eligibleForLifecycleDecision?(input: { limit: number }): Promise<LearningLesson[]> | LearningLesson[] };
type LifecycleRepositoryLike = { save(record: StrategyLifecycleDecision): Promise<unknown> | unknown };

export async function createEvaluationsFromSignals(input: { repositories: { signals?: SignalSourceRepositoryLike; evaluations?: EvaluationRepositoryLike }; cycleId: string; correlationId: string; now: Date; limit: number; guard?: CycleLeaseGuard }) {
  const source = input.repositories.signals;
  const target = input.repositories.evaluations;
  if (!source?.eligibleForEvaluation || !target?.saveEvaluation) return 0;
  const service = new ExternalEvaluationV2Service();
  let inserted = 0;
  for (const signal of await source.eligibleForEvaluation({ now: input.now, limit: input.limit * 4 })) {
    const eligibility = evaluateSignalForEvaluationEligibility(signal, input.now);
    structuredLogger.v2({ level: "info", event: "evaluation_candidate_evaluated", message: "V2 evaluation candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, signalId: signal.signalId, eligibility });
    if (!eligibility.eligible) continue;
    if (inserted >= input.limit) break;
    const evaluation = service.receive(evaluationInputFromSignal(signal, input.now));
    if (!evaluation.evaluation) continue;
    try {
      const saved = await guarded(input.guard, "evaluation_save", () => target.saveEvaluation(evaluation.evaluation!));
      const persisted = evaluationFromSaveResult(saved) ?? evaluation.evaluation;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "evaluation_duplicate_suppressed", message: "Duplicate V2 evaluation suppressed", cycleId: input.cycleId, correlationId: input.correlationId, evaluationId: persisted.evaluationId, signalId: signal.signalId, conflict: conflictFromSaveResult(saved) ?? "idempotent" });
        continue;
      }
      inserted += 1;
      structuredLogger.v2({ level: "info", event: "evaluation_inserted", message: "V2 evaluation persisted", cycleId: input.cycleId, correlationId: input.correlationId, evaluationId: persisted.evaluationId, signalId: signal.signalId });
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "evaluation_persistence_failed", message: "V2 evaluation persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, signalId: signal.signalId, error });
    }
  }
  return inserted;
}

export async function createJournalEntriesFromEvaluations(input: { repositories: { evaluations?: EvaluationRepositoryLike; journal?: JournalRepositoryLike }; cycleId: string; correlationId: string; now: Date; limit: number; guard?: CycleLeaseGuard }) {
  const source = input.repositories.evaluations;
  const target = input.repositories.journal;
  if (!source?.eligibleForJournal || !target?.append) return 0;
  const service = new ResearchJournalV2Service();
  let inserted = 0;
  for (const evaluation of await source.eligibleForJournal({ limit: input.limit * 4 })) {
    const eligibility = evaluateEvaluationForJournalEligibility(evaluation);
    structuredLogger.v2({ level: "info", event: "journal_candidate_evaluated", message: "V2 journal candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, evaluationId: evaluation.evaluationId, signalId: evaluation.signalId, eligibility });
    if (!eligibility.eligible) continue;
    if (inserted >= input.limit) break;
    const entry = service.record(journalInputFromEvaluation(evaluation, input.now));
    if (!entry.entry) continue;
    try {
      const saved = await guarded(input.guard, "journal_save", () => target.append(entry.entry!));
      const persisted = journalFromSaveResult(saved) ?? entry.entry;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "journal_duplicate_suppressed", message: "Duplicate V2 journal entry suppressed", cycleId: input.cycleId, correlationId: input.correlationId, journalEntryId: persisted.journalEntryId, evaluationId: evaluation.evaluationId, conflict: conflictFromSaveResult(saved) ?? "idempotent" });
        continue;
      }
      inserted += 1;
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "journal_persistence_failed", message: "V2 journal persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, evaluationId: evaluation.evaluationId, error });
    }
  }
  return inserted;
}

export async function createLessonsFromJournalEntries(input: { repositories: { journal?: JournalRepositoryLike; learning?: LearningRepositoryLike }; cycleId: string; correlationId: string; limit: number; guard?: CycleLeaseGuard }) {
  const source = input.repositories.journal;
  const target = input.repositories.learning;
  if (!source?.eligibleForLesson || !target?.saveLesson) return 0;
  const service = new LearningV2Service();
  let inserted = 0;
  for (const journal of await source.eligibleForLesson({ limit: input.limit * 4 })) {
    const eligibility = evaluateJournalForLessonEligibility(journal);
    structuredLogger.v2({ level: "info", event: "lesson_candidate_evaluated", message: "V2 lesson candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, journalEntryId: journal.journalEntryId, eligibility });
    if (!eligibility.eligible) continue;
    if (inserted >= input.limit) break;
    const lesson = service.generateLesson(lessonRequestFromJournal(journal));
    if (!lesson.lesson) continue;
    try {
      const saved = await guarded(input.guard, "lesson_save", () => target.saveLesson(lesson.lesson!));
      const persisted = lessonFromSaveResult(saved) ?? lesson.lesson;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "lesson_duplicate_suppressed", message: "Duplicate V2 lesson suppressed", cycleId: input.cycleId, correlationId: input.correlationId, lessonId: persisted.lessonId, journalEntryId: journal.journalEntryId, conflict: conflictFromSaveResult(saved) ?? "idempotent" });
        continue;
      }
      inserted += 1;
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "lesson_persistence_failed", message: "V2 lesson persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, journalEntryId: journal.journalEntryId, error });
    }
  }
  return inserted;
}

export async function createLifecycleDecisionsFromLessons(input: { repositories: { learning?: LearningRepositoryLike; lifecycle?: LifecycleRepositoryLike }; cycleId: string; correlationId: string; now: Date; limit: number; guard?: CycleLeaseGuard }) {
  const source = input.repositories.learning;
  const target = input.repositories.lifecycle;
  if (!source?.eligibleForLifecycleDecision || !target?.save) return 0;
  const service = new StrategyLifecycleV2Service();
  let inserted = 0;
  for (const lesson of await source.eligibleForLifecycleDecision({ limit: input.limit * 4 })) {
    const eligibility = evaluateLessonForLifecycleEligibility(lesson);
    structuredLogger.v2({ level: "info", event: "lifecycle_candidate_evaluated", message: "V2 lifecycle candidate evaluated", cycleId: input.cycleId, correlationId: input.correlationId, lessonId: lesson.lessonId, eligibility });
    if (!eligibility.eligible) continue;
    if (inserted >= input.limit) break;
    const decision = service.recordDecision(lifecycleInputFromLesson(lesson, input.now));
    if (!decision.decision) continue;
    try {
      const saved = await guarded(input.guard, "lifecycle_save", () => target.save(decision.decision!));
      const persisted = lifecycleFromSaveResult(saved) ?? decision.decision;
      if (!saveInserted(saved)) {
        structuredLogger.v2({ level: "info", event: "lifecycle_duplicate_suppressed", message: "Duplicate V2 lifecycle decision suppressed", cycleId: input.cycleId, correlationId: input.correlationId, decisionId: persisted.decisionId, lessonId: lesson.lessonId, conflict: conflictFromSaveResult(saved) ?? "idempotent" });
        continue;
      }
      inserted += 1;
    } catch (error) {
      structuredLogger.v2Error({ level: "error", event: "lifecycle_persistence_failed", message: "V2 lifecycle persistence failed", cycleId: input.cycleId, correlationId: input.correlationId, lessonId: lesson.lessonId, error });
    }
  }
  return inserted;
}

function evaluationInputFromSignal(signal: V2ResearchSignal, now: Date) {
  const positive = signal.takeProfit > signal.entryPrice;
  const outcome = positive ? "tp" as const : "expired" as const;
  return { evaluationId: stableHash({ signalId: signal.signalId, evaluator: "fincoach-deterministic-research-evaluator-v1" }), signalId: signal.signalId, evaluatorVersion: "fincoach-deterministic-research-evaluator-v1", entryReached: true, slReached: false, tpReached: positive, outcome, r: positive ? 1 : 0, profitLoss: positive ? 1 : 0, mfe: positive ? 1 : 0, mae: 0, holdingDurationMinutes: 60, dataSource: "fincoach-research-simulation", evaluatedAt: now.toISOString(), notes: "Deterministic research-only evaluation; no broker or execution call performed.", lineageEventIds: [...signal.lineageEventIds, signal.signalId], correlationId: signal.correlationId, causationId: signal.causationId };
}

function journalInputFromEvaluation(evaluation: ExternalEvaluation, now: Date) {
  return { journalEntryId: stableHash({ evaluationId: evaluation.evaluationId, subject: "external_evaluation" }), subjectType: "external_evaluation" as const, subjectId: evaluation.evaluationId, sourceModule: "external-evaluation" as const, summary: `Research signal evaluation ${evaluation.outcome}.`, evidence: { evaluationId: evaluation.evaluationId, signalId: evaluation.signalId, outcome: evaluation.outcome, r: evaluation.r }, conclusion: evaluation.r > 0 ? "positive research outcome" : "nonpositive research outcome", limitations: ["deterministic research-only evaluation"], supersedesEntryId: null, createdAt: now.toISOString(), lineageEventIds: [...evaluation.lineageEventIds, evaluation.evaluationId], correlationId: evaluation.correlationId, causationId: evaluation.causationId };
}

function lessonRequestFromJournal(journal: ResearchJournalEntry) {
  const evidence = journal.evidence as { outcome?: "tp" | "sl" | "expired" | "cancelled"; r?: number; signalId?: string };
  const outcome: LearningOutcome = evidence.outcome ?? "unknown";
  return { topic: `signal:${evidence.signalId ?? journal.subjectId}`, journalEntries: [{ journalEntryId: journal.journalEntryId, subjectId: journal.subjectId, outcome, r: Number(evidence.r ?? 0), tags: [String(outcome)], limitations: journal.limitations, createdAt: journal.createdAt, lineageEventIds: journal.lineageEventIds }], minimumSamples: 1, correlationId: journal.correlationId, causationId: journal.causationId };
}

function lifecycleInputFromLesson(lesson: LearningLesson, now: Date) {
  const toState = lesson.attribution.averageR > 0 ? "candidate" as const : "degraded" as const;
  return { decisionId: stableHash({ lessonId: lesson.lessonId, toState }), strategyId: lesson.topic, fromState: "forward-test" as const, toState, reason: `Research lesson outcome averageR=${lesson.attribution.averageR}`, metrics: { expectancy: lesson.attribution.averageR, drawdown: 0, calibration: lesson.confidence, evidenceAgeDays: 0, regimeMismatch: 0, externalDisagreement: 0, edgeDecay: lesson.attribution.averageR > 0 ? 0 : 0.4 }, createdAt: now.toISOString(), lineageEventIds: [...lesson.lineageEventIds, lesson.lessonId], correlationId: lesson.correlationId, causationId: lesson.causationId };
}

function evaluationFromSaveResult(saved: unknown): ExternalEvaluation | null { const r = saved as { record?: ExternalEvaluation; evaluation?: ExternalEvaluation; existing?: ExternalEvaluation }; return r.record ?? r.evaluation ?? r.existing ?? null; }
function journalFromSaveResult(saved: unknown): ResearchJournalEntry | null { const r = saved as { record?: ResearchJournalEntry; entry?: ResearchJournalEntry; existing?: ResearchJournalEntry }; return r.record ?? r.entry ?? r.existing ?? null; }
function lessonFromSaveResult(saved: unknown): LearningLesson | null { const r = saved as { record?: LearningLesson; lesson?: LearningLesson; existing?: LearningLesson }; return r.record ?? r.lesson ?? r.existing ?? null; }
function lifecycleFromSaveResult(saved: unknown): StrategyLifecycleDecision | null { const r = saved as { record?: StrategyLifecycleDecision; decision?: StrategyLifecycleDecision; existing?: StrategyLifecycleDecision }; return r.record ?? r.decision ?? r.existing ?? null; }

function artifactLimit(config: Pick<V2RuntimeConfig, "databaseWriteBudget">) {
  return Math.max(1, Math.min(20, config.databaseWriteBudget));
}

type RuntimeOrchestrationRepository = {
  renewLease?(input: { leaseName: string; workerId: string; fencingToken: number; now: Date; ttlMs: number; correlationId: string }): Promise<DurableWorkerLease | null> | DurableWorkerLease | null;
  verifyLease?(input: { leaseName: string; workerId: string; fencingToken: number; now: Date }): Promise<boolean> | boolean;
  recoverStaleCycles?(input: { now: Date; staleAfterMs: number; limit: number; correlationId: string }): Promise<Array<{ cycleId: string }>> | Array<{ cycleId: string }>;
};

class LeaseLostError extends Error {
  constructor(readonly reason: "lease_lost" | "cycle_timeout", readonly stage: string) {
    super(`${reason}:${stage}`);
  }
}

class CycleLeaseGuard {
  private timer: NodeJS.Timeout | null = null;
  private lostReason: "lease_lost" | "cycle_timeout" | null = null;
  private renewals = 0;
  private readonly lostPromise: Promise<"lease_lost" | "cycle_timeout">;
  private resolveLost!: (reason: "lease_lost" | "cycle_timeout") => void;

  constructor(
    private readonly repository: RuntimeOrchestrationRepository,
    private readonly lease: DurableWorkerLease,
    private readonly config: { ttlMs: number; renewIntervalMs: number; correlationId: string; cycleId: string; runtimeInstanceId: string },
  ) {
    this.lostPromise = new Promise(resolve => {
      this.resolveLost = resolve;
    });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.renew();
    }, this.config.renewIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.renewals > 0) {
      structuredLogger.v2({ level: "debug", event: "lease_renewal_summary", message: "V2 runtime lease renewal summary", cycleId: this.config.cycleId, correlationId: this.config.correlationId, runtimeInstanceId: this.config.runtimeInstanceId, leaseKey: this.lease.leaseName, ownerId: safeOwnerId(this.lease.workerId), fencingToken: this.lease.fencingToken, renewals: this.renewals });
    }
  }

  cancel(reason: "cycle_timeout" | "lease_lost") {
    if (this.lostReason) return;
    this.lostReason = reason;
    this.resolveLost(reason);
  }

  currentReason() {
    return this.lostReason;
  }

  async assertOwned(stage: string) {
    if (this.lostReason) throw new LeaseLostError(this.lostReason, stage);
    if (!this.repository.verifyLease) return;
    const owned = await this.repository.verifyLease({ leaseName: this.lease.leaseName, workerId: this.lease.workerId, fencingToken: this.lease.fencingToken, now: new Date() });
    if (!owned) {
      this.cancel("lease_lost");
      throw new LeaseLostError("lease_lost", stage);
    }
  }

  async tryAssertOwned(stage: string) {
    try {
      await this.assertOwned(stage);
      return true;
    } catch {
      return false;
    }
  }

  async waitForLoss(stage: string): Promise<never> {
    const reason = await this.lostPromise;
    throw new LeaseLostError(reason, stage);
  }

  private async renew() {
    if (this.lostReason) return;
    if (!this.repository.renewLease) return;
    try {
      const renewed = await this.repository.renewLease({ leaseName: this.lease.leaseName, workerId: this.lease.workerId, fencingToken: this.lease.fencingToken, now: new Date(), ttlMs: this.config.ttlMs, correlationId: this.config.correlationId });
      if (!renewed) {
        this.cancel("lease_lost");
        structuredLogger.v2({ level: "error", event: "lease_renewal_failed", message: "V2 runtime lease renewal failed", cycleId: this.config.cycleId, correlationId: this.config.correlationId, runtimeInstanceId: this.config.runtimeInstanceId, leaseKey: this.lease.leaseName, ownerId: safeOwnerId(this.lease.workerId), fencingToken: this.lease.fencingToken, reason: "ownership_mismatch_or_expired" });
        return;
      }
      this.renewals += 1;
      if (this.renewals === 1 || this.renewals % 10 === 0) {
        structuredLogger.v2({ level: "debug", event: "lease_renewed", message: "V2 runtime lease renewed", cycleId: this.config.cycleId, correlationId: this.config.correlationId, runtimeInstanceId: this.config.runtimeInstanceId, leaseKey: this.lease.leaseName, ownerId: safeOwnerId(this.lease.workerId), fencingToken: this.lease.fencingToken, renewals: this.renewals });
      }
    } catch (error) {
      this.cancel("lease_lost");
      structuredLogger.v2Error({ level: "error", event: "lease_renewal_failed", message: "V2 runtime lease renewal failed", cycleId: this.config.cycleId, correlationId: this.config.correlationId, runtimeInstanceId: this.config.runtimeInstanceId, leaseKey: this.lease.leaseName, ownerId: safeOwnerId(this.lease.workerId), fencingToken: this.lease.fencingToken, error });
    }
  }
}

async function guarded<T>(guard: CycleLeaseGuard | undefined, stage: string, write: () => Promise<T> | T): Promise<T> {
  await guard?.assertOwned(stage);
  return write();
}

async function recoverStaleCycles(repository: { recoverStaleCycles?: RuntimeOrchestrationRepository["recoverStaleCycles"] }, input: { now: Date; staleAfterMs: number; correlationId: string }) {
  return repository.recoverStaleCycles?.({ ...input, limit: 10 }) ?? [];
}

async function admitResearchCycle(repository: {
  admitCycle?: (input: { cycle: ResearchCycleRecord; maxCyclesPerDay: number; now: Date; admissionTimezone?: "UTC" }) => Promise<CycleAdmissionResult> | CycleAdmissionResult;
  saveCycle?: (cycle: ResearchCycleRecord) => Promise<{ inserted: boolean; record?: ResearchCycleRecord; cycle?: ResearchCycleRecord }> | { inserted: boolean; record?: ResearchCycleRecord; cycle?: ResearchCycleRecord };
}, input: { cycle: ResearchCycleRecord; maxCyclesPerDay: number; now: Date; admissionTimezone: "UTC" }): Promise<CycleAdmissionResult> {
  if (repository.admitCycle) return repository.admitCycle(input);
  const saved = await repository.saveCycle?.(input.cycle);
  return {
    admitted: saved?.inserted === true,
    reason: saved?.inserted === false ? "duplicate_cycle_window_suppressed" : undefined,
    cycle: saved?.record ?? saved?.cycle ?? input.cycle,
    admittedCount: saved?.inserted ? 1 : 0,
    limit: input.maxCyclesPerDay,
    admissionDate: input.now.toISOString().slice(0, 10),
  };
}

function cycleFailureReason(error: unknown, guard: CycleLeaseGuard) {
  if (error instanceof LeaseLostError) return error.reason;
  return guard.currentReason() ?? classifyRuntimeErrorCode(error);
}

function safeOwnerId(ownerId: string) {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 12);
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

function detectLiquiditySweep(candles: NormalizedCandle[]) {
  if (candles.length < 50) return false;
  const last = candles.at(-1)!;
  const prior = candles.slice(-21, -1);
  const priorHigh = Math.max(...prior.map(candle => candle.high));
  const priorLow = Math.min(...prior.map(candle => candle.low));
  const range = Math.max(priorHigh - priorLow, 0.000001);
  const sweptHigh = last.high > priorHigh && last.close < priorHigh;
  const sweptLow = last.low < priorLow && last.close > priorLow;
  return (sweptHigh || sweptLow) && Math.abs(last.close - (sweptHigh ? priorHigh : priorLow)) <= range * 0.35;
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
