import { createHash, randomUUID } from "crypto";
import { createDomainEvent } from "../contracts";
import { orchestrationV2Service } from "../orchestration";
import { V2PersistenceError } from "../persistence/errors";
import type { V2DailyResearchReport, V2ModuleAvailabilityDetail, V2OperationsAvailability, V2OperationsCollection, V2OperationsQuery, V2OperationsResponse } from "./contracts";
import { V2OperationsEventTypes } from "./events";
import { InMemoryV2OperationsRepository, type DailyReportDeliveryRecord, type DailyReportRecord } from "./repository";
import type { DurableWorkerLease, ResearchCycleRecord } from "../orchestration/contracts";
import type { DemoResearchPilotRecord } from "../pilot/contracts";
import { loadV2RuntimeConfig } from "../runtime/config";
import { validateResearchUniverse } from "../researchUniverse";
import { strategyTemplateInventory } from "../strategyTemplates";
import { deploymentMetadata } from "../../deploymentMetadata";
import { emitReportDeliverySummary } from "../../observerTelemetry";

type ProjectionRepositories = {
  operations?: DurableOperationsProjectionRepository | InMemoryV2OperationsRepository;
  orchestration?: OrchestrationProjectionRepository;
  pilot?: PilotProjectionRepository;
  ranking?: EvidenceProjectionRepository;
  evidence?: Partial<Record<V2OperationsCollection, EvidenceProjectionRepository>>;
};

type V2RuntimeStatusProvider = () => Record<string, unknown>;

type OrchestrationProjectionRepository = {
  latestCycle(status?: ResearchCycleRecord["status"]): Promise<ResearchCycleRecord | null>;
  retryCounts(): Promise<{ pending: number; exhausted: number }>;
  activeLeases(now: Date): Promise<DurableWorkerLease[]>;
  staleLeases(now: Date): Promise<DurableWorkerLease[]>;
  deadLetterCount(): Promise<number>;
  listCycles(input: { limit: number; offset: number; status?: string }): Promise<{ items: ResearchCycleRecord[]; total: number }>;
};

type PilotProjectionRepository = {
  list(): Promise<DemoResearchPilotRecord[]>;
};

type DurableOperationsProjectionRepository = {
  latestReport(): Promise<DailyReportRecord | null>;
  getReportByDate(reportDate: string): Promise<DailyReportRecord | null>;
  saveReport(record: DailyReportRecord): Promise<{ inserted: boolean; record: DailyReportRecord }>;
  saveDelivery(record: DailyReportDeliveryRecord): Promise<{ inserted: boolean; record: DailyReportDeliveryRecord }>;
  researchProgress?(now?: Date): Promise<Record<string, unknown>>;
  researchBlockers?(now?: Date): Promise<Record<string, unknown>>;
  invalidDailyReportCount?(): Promise<number>;
};

type EvidenceProjectionRepository = {
  listPage(input?: { limit?: number; offset?: number; strategyId?: string; symbol?: string; status?: string }): Promise<{ items: Record<string, unknown>[]; total: number }>;
};

type CollectionProjection = {
  availability: V2OperationsAvailability;
  items: Record<string, unknown>[];
  total: number;
  warning?: string;
  repositoryPaged?: boolean;
};

const collectionAvailability: Record<V2OperationsCollection, V2OperationsAvailability> = {
  observations: "not_configured",
  hypotheses: "not_configured",
  experiments: "not_configured",
  backtests: "not_configured",
  "court-cases": "not_configured",
  strategies: "not_configured",
  "forward-tests": "not_configured",
  signals: "not_configured",
  evaluations: "not_configured",
  journal: "not_configured",
  lessons: "not_configured",
  models: "not_configured",
  lifecycle: "not_configured",
  orchestration: "available_empty",
};

const RECONCILIATION_STAGES = [
  { label: "observations", pipelineKey: "observations", collection: "observations" },
  { label: "hypotheses", pipelineKey: "hypotheses", collection: "hypotheses" },
  { label: "strategies", pipelineKey: "strategies", collection: "strategies" },
  { label: "experiments", pipelineKey: "experiments", collection: "experiments" },
  { label: "backtests", pipelineKey: "backtests", collection: "backtests" },
  { label: "verdicts", pipelineKey: "verdicts", collection: "court-cases" },
  { label: "ranked candidates", pipelineKey: "rankedCandidates" },
  { label: "forward tests", pipelineKey: "forwardTests", collection: "forward-tests" },
  { label: "signals", pipelineKey: "signals", collection: "signals" },
  { label: "evaluations", pipelineKey: "evaluations", collection: "evaluations" },
  { label: "journal entries", pipelineKey: "journalEntries", collection: "journal" },
  { label: "lessons", pipelineKey: "lessons", collection: "lessons" },
  { label: "lifecycle decisions", pipelineKey: "lifecycleDecisions", collection: "lifecycle" },
] as const satisfies ReadonlyArray<{ label: string; pipelineKey: string; collection?: V2OperationsCollection }>;

export class V2OperationsService {
  constructor(
    private readonly repositories: ProjectionRepositories = { operations: new InMemoryV2OperationsRepository() },
    private readonly moduleAvailabilityDetails: Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>> = {},
    private readonly runtimeStatusProvider?: V2RuntimeStatusProvider,
  ) {}

  status(query: { correlationId?: string } = {}): V2OperationsResponse<Record<string, unknown>> {
    const correlationId = query.correlationId ?? randomUUID();
    const orchestration = orchestrationV2Service.health();
    const latestReport = this.syncOperationsRepository()?.latestReport?.() ?? null;
    const body = {
      schemaVersion: "fincoach.v2.operations-status.1",
      correlationId,
      moduleHealth: {
        orchestration: orchestration.status,
        operations: latestReport ? "healthy" : "degraded",
        telegram: "healthy",
        api: "healthy",
      },
      moduleAvailability: defaultAvailability(this.moduleAvailabilityDetails),
      moduleAvailabilityDetails: defaultAvailabilityDetails(this.moduleAvailabilityDetails),
      latestSuccessfulCycle: null,
      latestFailedCycle: null,
      latestSuccessfulCheckpoint: null,
      pendingRetries: 0,
      exhaustedRetries: 0,
      staleWorkerLeases: 0,
      queueDepth: orchestration.queueDepth,
      deadLetterCount: orchestration.deadLetters,
      activeWorkerLeases: orchestration.activeWorkerLeases,
      observationsCreated: 0,
      hypothesesCreated: 0,
      experimentsQueued: 0,
      backtestsCompleted: 0,
      courtroomVerdicts: 0,
      rankedCandidates: 0,
      forwardTests: 0,
      signals: 0,
      externalEvaluations: 0,
      journalEntries: 0,
      lessons: 0,
      lifecycleStates: 0,
      pilotState: null,
      latestScorecard: null,
      latestDailyReport: latestReport?.report ?? null,
      deliveryState: latestReport ? "available" : "available_empty",
      killSwitchState: "inactive",
      liveExecutionBlocked: true,
      postgresqlHealth: this.hasDurableRepositories() ? "unknown" : "not_configured",
      providerHealth: "not_configured",
      infrastructureHealth: "healthy",
      databaseHealth: this.hasDurableRepositories() ? "unknown" : "not_configured",
      runtimeState: "disabled",
      researchState: "disabled",
      paperExecutionState: "disabled",
      demoBrokerState: "disabled",
      telegramPublicationState: "disabled",
      configurationState: "incomplete",
      economicEvidenceState: "not_configured",
      deployedRevision: deploymentMetadata(),
      ...(this.runtimeStatusProvider?.() ?? {}),
    };
    return { status: 200, body, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "status" })] };
  }

  async statusAsync(query: { correlationId?: string } = {}): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const base = this.status(query);
    const body = { ...base.body };
    const moduleAvailability = { ...(body.moduleAvailability as Record<string, V2OperationsAvailability>) };
    const moduleHealth = { ...(body.moduleHealth as Record<string, string>) };
    let canonicalProgressAttempted = false;
    let canonicalProgressFailed = false;
    try {
      if (this.repositories.orchestration) {
        const [latestSuccessfulCycle, latestFailedCycle, retryCounts, activeLeases, staleLeases, deadLetterCount] = await Promise.all([
          this.repositories.orchestration.latestCycle("completed"),
          this.repositories.orchestration.latestCycle("failed"),
          this.repositories.orchestration.retryCounts(),
          this.repositories.orchestration.activeLeases(new Date()),
          this.repositories.orchestration.staleLeases(new Date()),
          this.repositories.orchestration.deadLetterCount(),
        ]);
        body.latestSuccessfulCycle = latestSuccessfulCycle;
        body.latestFailedCycle = latestFailedCycle;
        body.pendingRetries = retryCounts.pending;
        body.exhaustedRetries = retryCounts.exhausted;
        body.activeWorkerLeases = activeLeases.length;
        body.staleWorkerLeases = staleLeases.length;
        body.deadLetterCount = deadLetterCount;
        moduleAvailability.orchestration = latestSuccessfulCycle || latestFailedCycle || deadLetterCount || activeLeases.length || staleLeases.length ? "available" : "available_empty";
        moduleHealth.orchestration = "healthy";
      }
      if (this.repositories.pilot) {
        const pilots = await this.repositories.pilot.list();
        const latest = pilots.at(-1) ?? null;
        body.pilotState = latest?.state ?? null;
        body.latestScorecard = latest?.scorecard ?? null;
        moduleAvailability.pilot = latest ? "available" : "available_empty";
        moduleHealth.pilot = "healthy";
      }
      if (this.asyncOperationsRepository()) {
        const repository = this.asyncOperationsRepository();
        body.postgresqlHealth = "healthy";
        body.databaseHealth = "healthy";
        try {
          const latestReport = await repository?.latestReport();
          body.latestDailyReport = latestReport?.report ?? null;
          body.deliveryState = latestReport ? "available" : "available_empty";
          moduleAvailability.operations = latestReport ? "available" : "available_empty";
          moduleHealth.operations = "healthy";
        } catch (error) {
          const availability = availabilityFromError(error);
          if (isDatabaseHealthFailure(error)) {
            body.postgresqlHealth = availability;
            body.databaseHealth = availability;
          }
          body.latestDailyReport = null;
          body.deliveryState = availability;
          moduleAvailability.operations = availability;
          moduleHealth.operations = "degraded";
          body.reportingDataInvalid = { ...(typeof body.reportingDataInvalid === "object" && body.reportingDataInvalid ? body.reportingDataInvalid : {}), dailyReports: "unknown", code: projectionErrorCode(error) };
        }
        try {
          if (repository?.invalidDailyReportCount) {
            const invalidDailyReports = await repository.invalidDailyReportCount();
            if (invalidDailyReports > 0) {
              body.reportingDataInvalid = { ...(typeof body.reportingDataInvalid === "object" && body.reportingDataInvalid ? body.reportingDataInvalid : {}), dailyReports: invalidDailyReports, code: "reporting_data_invalid" };
            }
          }
        } catch (error) {
          if (isDatabaseHealthFailure(error)) {
            const availability = availabilityFromError(error);
            body.postgresqlHealth = availability;
            body.databaseHealth = availability;
          }
          body.reportingDataInvalid = { ...(typeof body.reportingDataInvalid === "object" && body.reportingDataInvalid ? body.reportingDataInvalid : {}), dailyReports: "unknown", code: projectionErrorCode(error) };
        }
        if (repository?.researchProgress) {
          canonicalProgressAttempted = true;
          try {
            const progress = await repository.researchProgress();
            const canonical = canonicalResearchProgressBody(progress) as Record<string, unknown>;
            const pipeline = canonical.pipeline as Record<string, unknown> | undefined;
            if (pipeline) {
              applyPipelineCounts(body, pipeline);
              applyPipelineAvailability(moduleAvailability, pipeline);
            }
            body.pipeline = pipeline ?? body.pipeline;
            body.reportingSource = canonical.reportingSource;
            body.reportingProjection = { ...(canonical.reportingSource as Record<string, unknown>), state: canonical.degraded ? "degraded" : "available" };
          } catch (error) {
            const reason = projectionErrorCode(error);
            canonicalProgressFailed = true;
            if (isDatabaseHealthFailure(error)) {
              const availability = availabilityFromError(error);
              body.postgresqlHealth = availability;
              body.databaseHealth = availability;
            }
            markDurableCountsUnavailable(body, reason);
            body.reportingSource = { source: "postgresql", databaseBacked: true, degraded: true, projectionError: reason, generatedAt: new Date().toISOString() };
            body.reportingProjection = { ...(body.reportingSource as Record<string, unknown>), state: "degraded" };
            body.degradedReason = reason;
          }
        }
      }
      const evidence = this.repositories.evidence ?? {};
      for (const collection of Object.keys(evidence) as V2OperationsCollection[]) {
        const count = await countEvidence(evidence[collection]);
        moduleAvailability[collection] = count > 0 ? "available" : "available_empty";
      }
      if (!body.pipeline && !canonicalProgressAttempted) {
        body.observationsCreated = await countEvidence(evidence.observations);
        body.hypothesesCreated = await countEvidence(evidence.hypotheses);
        body.experimentsQueued = await countEvidence(evidence.experiments);
        body.backtestsCompleted = await countEvidence(evidence.backtests);
        body.forwardTests = await countEvidence(evidence["forward-tests"]);
        body.signals = await countEvidence(evidence.signals);
        body.externalEvaluations = await countEvidence(evidence.evaluations);
        body.journalEntries = await countEvidence(evidence.journal);
        body.lessons = await countEvidence(evidence.lessons);
        body.lifecycleStates = await countEvidence(evidence.lifecycle);
        body.courtroomVerdicts = await countEvidence(evidence["court-cases"]);
        body.rankedCandidates = await countEvidence(this.repositories.ranking);
      }
      if (canonicalProgressFailed) body.pipeline = { status: "unavailable", projectionError: body.degradedReason ?? "projection_failed" };
    } catch (error) {
      const availability = availabilityFromError(error);
      body.postgresqlHealth = availability;
      body.moduleHealth = { ...moduleHealth, operations: "degraded" };
      body.moduleAvailability = { ...moduleAvailability, operations: availability };
      body.degradedReason = projectionErrorCode(error);
      return { ...base, status: 200, body };
    }
    body.moduleHealth = moduleHealth;
    body.moduleAvailability = moduleAvailability;
    body.moduleAvailabilityDetails = Object.fromEntries(Object.entries(moduleAvailability).map(([module, state]) => {
      const configured = this.moduleAvailabilityDetails[module as V2OperationsCollection | "operations" | "pilot"];
      return [module, configured?.state === state ? configured : { state, reason: reasonForAvailability(state) }];
    }));
    return { ...base, body };
  }

  async researchProgress(): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const correlationId = randomUUID();
    const repository = this.asyncOperationsRepository();
    if (!repository?.researchProgress) {
      const at = new Date().toISOString();
      return { status: 200, body: canonicalResearchProgressBody({ schemaVersion: "fincoach.v2.research-progress.1", status: "degraded", generatedAt: at, source: "not_configured", databaseBacked: false, degraded: true, reason: "postgres_projection_not_configured", projectionError: "postgres_projection_not_configured", liveExecutionBlocked: true }), events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_progress" })] };
    }
    try {
      return { status: 200, body: canonicalResearchProgressBody(await repository.researchProgress()), events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_progress" })] };
    } catch (error) {
      const reason = projectionErrorCode(error);
      const at = new Date().toISOString();
      return { status: 200, body: canonicalResearchProgressBody({ schemaVersion: "fincoach.v2.research-progress.1", status: "degraded", generatedAt: at, source: "postgresql", databaseBacked: true, degraded: true, reason, projectionError: reason, liveExecutionBlocked: true }), events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_progress_degraded" })] };
    }
  }

  async researchBlockers(): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const correlationId = randomUUID();
    const repository = this.asyncOperationsRepository();
    if (!repository?.researchBlockers) {
      return { status: 200, body: { schemaVersion: "fincoach.v2.research-blockers.1", generatedAt: new Date().toISOString(), highestSeverity: "warning", blockers: [{ code: "postgres_projection_not_configured", severity: "warning", phase: "operations", reason: "PostgreSQL research blocker projection is not configured.", currentValue: "not_configured", requiredValue: "configured", recommendedAction: "Initialize V2 runtime with PostgreSQL repositories.", firstObservedAt: new Date().toISOString(), lastObservedAt: new Date().toISOString() }], liveExecutionBlocked: true }, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_blockers" })] };
    }
    try {
      return { status: 200, body: this.withRuntimeBlockers(await repository.researchBlockers()), events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_blockers" })] };
    } catch (error) {
      const at = new Date().toISOString();
      const reason = projectionErrorCode(error);
      return { status: 200, body: { schemaVersion: "fincoach.v2.research-blockers.1", status: "degraded", generatedAt: at, highestSeverity: "warning", blockers: [{ code: reason, severity: "warning", phase: "operations", reason: "PostgreSQL blocker projection failed.", currentValue: "failed", requiredValue: "healthy", recommendedAction: "Check database connectivity and migrations.", firstObservedAt: at, lastObservedAt: at }], projectionError: reason, liveExecutionBlocked: true }, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "research_blockers_degraded" })] };
    }
  }

  async dataReconciliation(): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const correlationId = randomUUID();
    const generatedAt = new Date().toISOString();
    const repository = this.asyncOperationsRepository();
    if (!repository?.researchProgress) {
      return {
        status: 200,
        body: {
          schemaVersion: "fincoach.v2.data-reconciliation.1",
          generatedAt,
          source: "not_configured",
          databaseBacked: false,
          overallStatus: "query_failed",
          projectionError: "postgres_projection_not_configured",
          comparisons: [],
          liveExecutionBlocked: true,
        },
        events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "data_reconciliation" })],
      };
    }
    try {
      const progress = await repository.researchProgress();
      const pipeline = progress.pipeline as Record<string, unknown>;
      const comparisons = await Promise.all(RECONCILIATION_STAGES.map(async stage => {
        try {
          const repositoryTotal = await this.reconciliationRepositoryCount(stage);
          if (repositoryTotal === null) return { stage: stage.label, canonical: Number(pipeline[stage.pipelineKey] ?? 0), repository: null, status: "not_configured" };
          const canonical = Number(pipeline[stage.pipelineKey] ?? 0);
          return { stage: stage.label, canonical, repository: repositoryTotal, status: canonical === repositoryTotal ? "match" : "mismatch" };
        } catch {
          return { stage: stage.label, canonical: Number(pipeline[stage.pipelineKey] ?? 0), repository: null, status: "query_failed" };
        }
      }));
      const statuses = comparisons.map(item => item.status);
      const overallStatus = statuses.includes("query_failed") ? "query_failed" : statuses.includes("mismatch") ? "mismatch" : statuses.includes("not_configured") ? "degraded" : "match";
      return {
        status: 200,
        body: {
          schemaVersion: "fincoach.v2.data-reconciliation.1",
          generatedAt,
          source: progress.source ?? "postgresql",
          databaseBacked: progress.databaseBacked ?? true,
          overallStatus,
          comparisons,
          liveExecutionBlocked: true,
        },
        events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "data_reconciliation" })],
      };
    } catch (error) {
      return {
        status: 200,
        body: {
          schemaVersion: "fincoach.v2.data-reconciliation.1",
          generatedAt,
          source: "postgresql",
          databaseBacked: true,
          overallStatus: "query_failed",
          projectionError: projectionErrorCode(error),
          comparisons: [],
          liveExecutionBlocked: true,
        },
        events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "data_reconciliation_degraded" })],
      };
    }
  }

  private withRuntimeBlockers(body: Record<string, unknown>) {
    const runtime = this.runtimeStatusProvider?.() ?? {};
    const aggregate = runtime.aggregateTradableWindow as { anyConfiguredInstrumentTradable?: boolean; calendarQuality?: string } | undefined;
    const blockers = Array.isArray(body.blockers) ? [...body.blockers] : [];
    const config = runtime.runtimeConfiguration as Record<string, unknown> | undefined;
    const pipeline = body.pipeline as Record<string, unknown> | undefined;
    const rankedCandidates = Number(pipeline?.rankedCandidates ?? 0);
    const at = new Date().toISOString();
    if (aggregate?.anyConfiguredInstrumentTradable === false) {
      blockers.push({
        code: "weekly_market_window_closed",
        severity: "info",
        phase: "scheduler",
        reason: "Weekly research market window is closed.",
        currentValue: "closed",
        requiredValue: "open",
        recommendedAction: "No action required. Research resumes automatically at the next weekly opening.",
        firstObservedAt: at,
        lastObservedAt: at,
      });
    }
    if (aggregate?.calendarQuality === "unavailable") {
      blockers.push({
        code: "market_session_calendar_unavailable",
        severity: "critical",
        phase: "scheduler",
        reason: "At least one configured instrument has unavailable session metadata.",
        currentValue: "unavailable",
        requiredValue: "configured",
        recommendedAction: "Add explicit session metadata or remove the unsupported configured symbol.",
        firstObservedAt: at,
        lastObservedAt: at,
      });
    }
    if (rankedCandidates > 0 && config?.forwardTestingEnabled === false) {
      blockers.push({ code: "forward_testing_disabled", severity: "warning", phase: "forward_testing", reason: "A ranked candidate cannot advance because forward testing is disabled.", currentValue: false, requiredValue: true, recommendedAction: "Keep disabled unless explicitly approving forward-test creation; do not enable as part of this audit.", firstObservedAt: at, lastObservedAt: at });
    }
    if (rankedCandidates > 0 && Number(config?.maxActiveForwardTests ?? 0) <= 0) {
      blockers.push({ code: "forward_test_capacity_zero", severity: "warning", phase: "forward_testing", reason: "A ranked candidate cannot advance because forward-test capacity is zero.", currentValue: config?.maxActiveForwardTests ?? 0, requiredValue: "> 0", recommendedAction: "Keep capacity zero unless explicitly approving forward-test creation.", firstObservedAt: at, lastObservedAt: at });
    }
    if ((Number(pipeline?.forwardTests ?? 0) > 0 || rankedCandidates > 0) && config?.researchSignalEnabled === false) {
      blockers.push({ code: "research_signal_creation_disabled", severity: "warning", phase: "signals", reason: "Forward-tested candidates cannot emit research signals because signal creation is disabled.", currentValue: false, requiredValue: true, recommendedAction: "Keep research signal creation disabled unless explicitly approved.", firstObservedAt: at, lastObservedAt: at });
    }
    if ((Number(pipeline?.forwardTests ?? 0) > 0 || rankedCandidates > 0) && Number(config?.maxActiveResearchSignals ?? 0) <= 0) {
      blockers.push({ code: "research_signal_capacity_zero", severity: "warning", phase: "signals", reason: "Forward-tested or ranked candidates cannot emit research signals because signal capacity is zero.", currentValue: config?.maxActiveResearchSignals ?? 0, requiredValue: "> 0", recommendedAction: "Keep research signal capacity zero unless explicitly approved.", firstObservedAt: at, lastObservedAt: at });
    }
    const severities = blockers.map((item) => typeof item === "object" && item && "severity" in item ? String((item as { severity?: unknown }).severity) : "info");
    const highestSeverity = severities.includes("critical") ? "critical" : severities.includes("warning") ? "warning" : "info";
    return { ...body, highestSeverity, blockers, liveExecutionBlocked: true };
  }

  list(collection: V2OperationsCollection, query: V2OperationsQuery = {}): V2OperationsResponse<Record<string, unknown>> {
    const validation = this.validateList(collection, query);
    if (validation) return validation;
    const correlationId = query.correlationId ?? randomUUID();
    const projection: CollectionProjection = {
      availability: collectionAvailability[collection],
      items: [],
      total: 0,
      warning: collection === "orchestration" ? undefined : "durable_projection_not_configured_for_collection",
    };
    return this.listResponse(collection, query, correlationId, projection);
  }

  async listAsync(collection: V2OperationsCollection, query: V2OperationsQuery = {}): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const validation = this.validateList(collection, query);
    if (validation) return validation;
    const correlationId = query.correlationId ?? randomUUID();
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    try {
      if (collection === "orchestration" && this.repositories.orchestration) {
        const cycles = await this.repositories.orchestration.listCycles({ limit, offset, status: query.status });
        return this.listResponse(collection, query, correlationId, {
          availability: cycles.total ? "available" : "available_empty",
          items: cycles.items.map(item => ({ ...item, sourceModule: "orchestration" })),
          total: cycles.total,
          repositoryPaged: true,
        });
      }
      const evidenceRepository = this.repositories.evidence?.[collection];
      if (evidenceRepository) {
        const records = await evidenceRepository.listPage({ limit, offset, status: query.status, strategyId: query.strategyId, symbol: query.symbol });
        return this.listResponse(collection, query, correlationId, {
          availability: records.total ? "available" : "available_empty",
          items: records.items.map(item => ({ ...item, sourceModule: item.sourceModule ?? collection })),
          total: records.total,
          repositoryPaged: true,
        });
      }
      const base = this.list(collection, query);
      return base;
    } catch (error) {
      return this.listResponse(collection, query, correlationId, {
        availability: availabilityFromError(error),
        items: [],
        total: 0,
        warning: error instanceof Error ? error.message : "projection unavailable",
      });
    }
  }

  dailyReport(input: { reportDate: string; correlationId?: string }): V2OperationsResponse<{ status: "created" | "existing"; report: V2DailyResearchReport }> {
    const correlationId = input.correlationId ?? randomUUID();
    const repository = this.syncOperationsRepository();
    const existing = repository?.getReportByDate(input.reportDate);
    if (existing) return { status: 200, body: { status: "existing", report: existing.report }, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { reportId: existing.report.reportId, status: "existing" })] };
    const report = this.createReport(input.reportDate);
    repository?.saveReport({ report, status: "created", correlationId, causationId: null, createdAt: report.createdAt, updatedAt: report.createdAt });
    return { status: 201, body: { status: "created", report }, events: [this.event(V2OperationsEventTypes.V2DailyReportCreated, correlationId, { reportId: report.reportId })] };
  }

  async dailyReportAsync(input: { reportDate: string; correlationId?: string }): Promise<V2OperationsResponse<{ status: "created" | "existing"; report: V2DailyResearchReport }>> {
    const correlationId = input.correlationId ?? randomUUID();
    const repository = this.asyncOperationsRepository();
    if (!repository) return this.dailyReport(input);
    const existing = await repository.getReportByDate(input.reportDate);
    if (existing) return { status: 200, body: { status: "existing", report: existing.report }, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { reportId: existing.report.reportId, status: "existing" })] };
    const status = await this.statusAsync({ correlationId });
    const report = this.createReport(input.reportDate, status.body);
    const saved = await repository.saveReport({ report, status: status.body.degradedReason ? "degraded" : "created", correlationId, causationId: null, createdAt: report.createdAt, updatedAt: report.createdAt });
    return { status: saved.inserted ? 201 : 200, body: { status: saved.inserted ? "created" : "existing", report: saved.record.report }, events: [this.event(saved.inserted ? V2OperationsEventTypes.V2DailyReportCreated : V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { reportId: saved.record.report.reportId })] };
  }

  recordDailyReportDelivery(reportId: string, input: { sent: boolean; error?: string; correlationId?: string }) {
    const correlationId = input.correlationId ?? randomUUID();
    return { events: [this.event(input.sent ? V2OperationsEventTypes.V2DailyReportDelivered : V2OperationsEventTypes.V2DailyReportDeliveryFailed, correlationId, { reportId, error: input.error ?? null })] };
  }

  async recordDailyReportDeliveryAsync(reportId: string, input: { destination: string; deliveryAttempt: number; sent: boolean; error?: string; correlationId?: string }) {
    const correlationId = input.correlationId ?? randomUUID();
    const repository = this.asyncOperationsRepository();
    if (repository) {
      const now = new Date().toISOString();
      const delivery: DailyReportDeliveryRecord = {
        deliveryId: createHash("sha256").update(`${reportId}:${input.destination}:${input.deliveryAttempt}`).digest("hex"),
        reportId,
        destination: redactDestination(input.destination),
        deliveryAttempt: input.deliveryAttempt,
        idempotencyKey: `${reportId}:${redactDestination(input.destination)}:${input.deliveryAttempt}`,
        status: input.sent ? "delivered" : "failed",
        errorCode: input.sent ? null : "delivery_failed",
        errorMessage: input.sent ? null : input.error ?? "redacted delivery failure",
        correlationId,
        causationId: null,
        createdAt: now,
        updatedAt: now,
      };
      await repository.saveDelivery(delivery);
    }
    emitReportDeliverySummary({
      correlationId,
      reportId,
      deliveryAttempt: input.deliveryAttempt,
      sent: input.sent,
      destinationHash: redactDestination(input.destination),
      reason: input.sent ? null : deliveryErrorCode(input.error),
      deployedRevision: deploymentMetadata(),
    });
    return this.recordDailyReportDelivery(reportId, { sent: input.sent, error: input.error, correlationId });
  }

  async telegramSummary(command: string) {
    if (command === "/research_today") return this.telegramResearchProgress();
    if (command === "/strategy_portfolio") return this.telegramStrategyPortfolio();
    if (command === "/v2_status") {
      const status = this.status().body;
      return [`Version 2 Status`, `Health: ${(status.moduleHealth as Record<string, string>).orchestration}`, `Dead letters: ${status.deadLetterCount}`, `Kill switch: ${status.killSwitchState}`, `Live execution: blocked`].join("\n");
    }
    if (command === "/strategy_leaderboard") {
      const ranking = await this.rankingProjection();
      return [
        "Version 2 strategy leaderboard",
        `Items: ${ranking.total}`,
        `State: ${operatorAvailabilityState(ranking.availability)}`,
        `Availability: ${ranking.availability}`,
        ranking.warning ? `Warning: ${ranking.warning}` : null,
        `Live execution: blocked`,
      ].filter(Boolean).join("\n");
    }
    const collection = commandToCollection(command);
    if (!collection) return "Unsupported Version 2 operations command.";
    const list = (await this.listAsync(collection, { limit: 5 })).body;
    return [
      `Version 2 ${commandLabel(command, collection)}`,
      `Items: ${(list.pagination as { total: number }).total}`,
      `State: ${operatorAvailabilityState(String(list.availability))}`,
      `Availability: ${list.availability}`,
      list.warning ? `Warning: ${list.warning}` : null,
      `Live execution: blocked`,
    ].filter(Boolean).join("\n");
  }

  async telegramResearchProgress() {
    const progress = (await this.researchProgress()).body as Record<string, unknown>;
    if (progress.degraded) return `FinCoach Research Progress\nState: degraded\nReason: ${progress.reason}\nLive execution blocked: true`;
    const windows = progress.windows as Record<string, Record<string, unknown>>;
    const coverage = progress.coverage as Record<string, unknown[] | string | null>;
    const pipeline = progress.pipeline as Record<string, unknown>;
    const readiness = progress.readiness as Record<string, unknown>;
    const evals = pipeline.detectorEvaluations as Record<string, unknown>;
    return [
      "FinCoach Research Progress",
      `Generated: ${progress.generatedAt}`,
      `Source: ${progress.source ?? "unknown"}`,
      `Latest completed cycle: ${JSON.stringify((progress.runtime as Record<string, unknown>)?.latestCompletedCycle ?? null).slice(0, 120)}`,
      "",
      "Last 1h / 24h / 7d / Total",
      ...formatWindowRows(windows),
      `- Evaluations attempted this hour: ${evals.attemptedCurrentHour ?? 0}`,
      `- Evaluations completed this hour: ${evals.completedCurrentHour ?? 0}`,
      `- Duplicates suppressed this hour: ${evals.duplicatesSuppressedCurrentHour ?? 0}`,
      `- Failures this hour: ${evals.failuresCurrentHour ?? 0}`,
      "",
      "Coverage",
      `- Active symbols: ${formatCoverage(coverage.symbols)}`,
      `- Active timeframes: ${formatCoverage(coverage.timeframes)}`,
      `- Active detectors: ${formatCoverage(coverage.detectors)}`,
      `- Strategy families evaluated: ${formatCoverage(coverage.strategyFamilies)}`,
      `- Most recent market-data timestamp: ${coverage.mostRecentMarketDataTimestamp ?? "none"}`,
      "",
      "Pipeline",
      `- Hypotheses: ${pipeline.hypotheses ?? 0}`,
      `- Strategies: ${pipeline.strategies ?? 0}`,
      `- Experiments: ${pipeline.experiments ?? 0}`,
      `- Backtests: ${pipeline.backtests ?? 0}`,
      `- Verdicts: ${pipeline.verdicts ?? 0}`,
      `- Ranked candidates: ${pipeline.rankedCandidates ?? 0}`,
      `- Forward tests: ${pipeline.forwardTests ?? 0}`,
      `- Research signals: ${pipeline.signals ?? 0}`,
      `- External evaluations: ${pipeline.evaluations ?? 0}`,
      `- Journal entries: ${pipeline.journalEntries ?? 0}`,
      `- Lessons: ${pipeline.lessons ?? 0}`,
      `- Lifecycle decisions: ${pipeline.lifecycleDecisions ?? 0}`,
      `- Pilot scorecards: ${pipeline.pilotScorecards ?? 0}`,
      "",
      "Readiness",
      `- Current stage: ${readiness.currentStage ?? "research"}`,
      `- Next required stage: ${readiness.nextStage ?? "backtest eligible"}`,
      `- Live execution blocked: ${readiness.liveExecutionBlocked ?? true}`,
      `- Paper execution state: ${readiness.paperExecutionState ?? "gated"}`,
      `- Demo execution state: ${readiness.demoExecutionState ?? "gated"}`,
    ].join("\n").slice(0, 3900);
  }

  async telegramStrategyPortfolio() {
    const progress = (await this.researchProgress()).body as Record<string, unknown>;
    if (progress.degraded) return `Strategy Portfolio\nState: degraded\nReason: ${progress.reason}\nLive execution: blocked`;
    const pipeline = progress.pipeline as Record<string, unknown>;
    const templates = progress.strategyTemplates as Record<string, unknown>;
    const universe = progress.strategyUniverse as Record<string, unknown> | undefined;
    const diversification = universe?.diversification as Record<string, unknown> | undefined;
    const concentration = diversification?.concentration as Record<string, Record<string, unknown>> | undefined;
    const warnings = Array.isArray(diversification?.concentrationWarnings) ? diversification.concentrationWarnings as string[] : [];
    return [
      "Strategy Portfolio",
      `Generated: ${progress.generatedAt}`,
      `Source: ${progress.source ?? "unknown"}`,
      `Durable strategies: ${pipeline.strategies ?? 0}`,
      `Ranked candidates: ${pipeline.rankedCandidates ?? 0}`,
      `Templates: ${templates.totalTemplates ?? 0} total, ${templates.enabledTemplates ?? 0} enabled, ${templates.blockedTemplates ?? 0} blocked`,
      `Families: ${formatCounts(templates.byFamily as Record<string, number> | undefined)}`,
      "",
      "Concentration",
      `- Family: ${formatConcentration(concentration?.family)}`,
      `- Session: ${formatConcentration(concentration?.session)}`,
      `- Symbol: ${formatConcentration(concentration?.symbol)}`,
      `- Regime: ${formatConcentration(concentration?.regime)}`,
      warnings.length ? `Warnings: ${warnings.slice(0, 5).join("; ")}` : "Warnings: none",
      "",
      "Blocked template classes",
      "- news_macro requires authoritative event data",
      "- relative_value requires explicit multi-symbol feature lineage",
      "Live execution: blocked",
    ].join("\n").slice(0, 3900);
  }

  async telegramResearchThroughput() {
    const progress = (await this.researchProgress()).body as Record<string, unknown>;
    if (progress.degraded) return `Research Throughput\nState: degraded\nReason: ${progress.reason}\nLive execution: blocked`;
    const windows = progress.windows as Record<string, Record<string, unknown>>;
    const pipeline = progress.pipeline as Record<string, unknown>;
    const evals = pipeline.detectorEvaluations as Record<string, unknown> | undefined;
    return [
      "Research Throughput",
      `Generated: ${progress.generatedAt}`,
      `Source: ${progress.source ?? "unknown"}`,
      "Last 1h / 24h / 7d / Total",
      ...formatWindowRows(windows),
      `Current-hour detector attempts: ${evals?.attemptedCurrentHour ?? 0}`,
      `Current-hour detector completions: ${evals?.completedCurrentHour ?? 0}`,
      `Current-hour duplicate suppressions: ${evals?.duplicatesSuppressedCurrentHour ?? 0}`,
    ].join("\n");
  }

  async telegramDataReconciliation() {
    const body = (await this.dataReconciliation()).body as Record<string, unknown>;
    const comparisons = Array.isArray(body.comparisons) ? body.comparisons as Array<Record<string, unknown>> : [];
    const failures = comparisons.filter(item => item.status !== "match");
    return [
      "Data Reconciliation",
      `Generated: ${body.generatedAt}`,
      `Source: ${body.source ?? "unknown"}`,
      `State: ${body.overallStatus}`,
      body.projectionError ? `Projection error: ${body.projectionError}` : null,
      "",
      ...(failures.length ? failures.slice(0, 12).map(item => `${item.stage}: ${item.status} API=${item.canonical ?? "n/a"} repo=${item.repository ?? "n/a"}`) : comparisons.map(item => `${item.stage}: match ${item.canonical}`)),
      `Live execution: blocked`,
    ].filter(Boolean).join("\n").slice(0, 3900);
  }

  async telegramResearchBlockers() {
    const body = (await this.researchBlockers()).body as Record<string, unknown>;
    const blockers = Array.isArray(body.blockers) ? body.blockers as Array<Record<string, unknown>> : [];
    return [
      "FinCoach Research Blockers",
      `Highest severity: ${body.highestSeverity ?? "unknown"}`,
      "",
      ...blockers.slice(0, 20).map(item => `- [${item.severity}] ${item.code} (${item.phase})\n  Reason: ${item.reason}\n  Current: ${item.currentValue ?? "n/a"} Required: ${item.requiredValue ?? "n/a"}\n  Next: ${item.recommendedAction}`),
    ].join("\n").slice(0, 3900);
  }

  private validateList(collection: V2OperationsCollection, query: V2OperationsQuery) {
    const correlationId = query.correlationId ?? randomUUID();
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    if (limit < 1 || limit > 100 || offset < 0) {
      return { status: 400, body: { schemaVersion: "fincoach.v2.error.1", message: "Invalid pagination", liveExecutionBlocked: true }, events: [this.event(V2OperationsEventTypes.V2OperationsRequestRejected, correlationId, { reason: "invalid_pagination", collection })] };
    }
    return null;
  }

  private listResponse(collection: V2OperationsCollection, query: V2OperationsQuery, correlationId: string, projection: CollectionProjection): V2OperationsResponse<Record<string, unknown>> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const filtered = projection.items.filter(item => {
      if (query.symbol && item.symbol !== query.symbol) return false;
      if (query.strategyId && item.strategyId !== query.strategyId) return false;
      if (query.status && item.status !== query.status && item.state !== query.status) return false;
      if (query.since && typeof item.updatedAt === "string" && item.updatedAt < query.since) return false;
      if (query.until && typeof item.updatedAt === "string" && item.updatedAt > query.until) return false;
      return true;
    });
    return {
      status: 200,
      body: {
        schemaVersion: "fincoach.v2.operations-list.1",
        collection,
        availability: projection.availability,
        items: projection.repositoryPaged ? filtered.slice(0, limit) : filtered.slice(offset, offset + limit),
        pagination: { limit, offset, total: projection.total || filtered.length },
        correlationId,
        warning: projection.warning,
        liveExecutionBlocked: true,
      },
      events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "list", collection })],
    };
  }

  private createReport(reportDate: string, statusBody: Record<string, unknown> = this.status().body): V2DailyResearchReport {
    if (!isAcceptableReportDate(reportDate)) throw new V2PersistenceError("malformed_persisted_record", "Daily report date is not an acceptable current or historical YYYY-MM-DD calendar date");
    return {
      reportId: createHash("sha256").update(reportDate).digest("hex").slice(0, 32),
      schemaVersion: "fincoach.v2.daily-research-report.1",
      reportDate,
      observations: Number(statusBody.observationsCreated ?? 0),
      hypotheses: Number(statusBody.hypothesesCreated ?? 0),
      experiments: Number(statusBody.experimentsQueued ?? 0),
      backtests: Number(statusBody.backtestsCompleted ?? 0),
      courtVerdicts: Number(statusBody.courtroomVerdicts ?? 0),
      rankingChanges: Number(statusBody.rankedCandidates ?? 0),
      forwardTests: Number(statusBody.forwardTests ?? 0),
      signals: Number(statusBody.signals ?? 0),
      externalEvaluations: Number(statusBody.externalEvaluations ?? 0),
      lessons: Number(statusBody.lessons ?? 0),
      lifecycleChanges: Number(statusBody.lifecycleStates ?? 0),
      operationalFailures: Number(statusBody.degradedReason ? 1 : 0),
      deadLetterEvents: Number(statusBody.deadLetterCount ?? 0),
      dataGaps: 0,
      staleDataIncidents: 0,
      moduleHealth: statusBody.moduleHealth as Record<string, string>,
      liveExecutionBlocked: true,
      createdAt: new Date().toISOString(),
    };
  }

  private syncOperationsRepository(): InMemoryV2OperationsRepository | null {
    return this.repositories.operations instanceof InMemoryV2OperationsRepository ? this.repositories.operations : null;
  }

  private asyncOperationsRepository(): DurableOperationsProjectionRepository | null {
    return this.repositories.operations && !(this.repositories.operations instanceof InMemoryV2OperationsRepository) ? this.repositories.operations : null;
  }

  private hasDurableRepositories(): boolean {
    return Boolean(this.repositories.orchestration || this.repositories.pilot || this.asyncOperationsRepository());
  }

  private async reconciliationRepositoryCount(stage: typeof RECONCILIATION_STAGES[number]) {
    const collection = "collection" in stage ? stage.collection : undefined;
    if (collection) {
      const repository = this.repositories.evidence?.[collection];
      return repository ? countEvidence(repository) : null;
    }
    if (stage.pipelineKey === "rankedCandidates") return this.repositories.ranking ? countEvidence(this.repositories.ranking) : null;
    return null;
  }

  private async rankingProjection() {
    if (!this.repositories.ranking) return { availability: "not_configured" as V2OperationsAvailability, total: 0, warning: "ranking_repository_not_injected" };
    try {
      const records = await this.repositories.ranking.listPage({ limit: 1, offset: 0 });
      return { availability: records.total ? "available" as const : "available_empty" as const, total: records.total, warning: undefined };
    } catch (error) {
      return { availability: availabilityFromError(error), total: 0, warning: projectionErrorCode(error) };
    }
  }

  private event(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "telemetry", correlationId, causationId: null, payload });
  }
}

function defaultAvailability(overrides: Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>> = {}): Record<V2OperationsCollection | "operations" | "pilot", V2OperationsAvailability> {
  const base: Record<V2OperationsCollection | "operations" | "pilot", V2OperationsAvailability> = { ...collectionAvailability, operations: "available_empty", pilot: "not_configured" };
  for (const [key, value] of Object.entries(overrides)) base[key as V2OperationsCollection | "operations" | "pilot"] = value.state;
  return base;
}

function defaultAvailabilityDetails(overrides: Partial<Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>> = {}): Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail> {
  const availability = defaultAvailability(overrides);
  return Object.fromEntries(Object.entries(availability).map(([module, state]) => [
    module,
    overrides[module as V2OperationsCollection | "operations" | "pilot"] ?? { state, reason: reasonForAvailability(state) },
  ])) as Record<V2OperationsCollection | "operations" | "pilot", V2ModuleAvailabilityDetail>;
}

function availabilityFromError(error: unknown): V2OperationsAvailability {
  if (error instanceof V2PersistenceError) {
    if (error.code === "database_unavailable") return "temporarily_unavailable";
    if (error.code === "migration_mismatch" || error.code === "unsupported_schema_version") return "schema_incompatible";
    if (error.code === "malformed_persisted_record") return "degraded";
  }
  return "degraded";
}

function isDatabaseHealthFailure(error: unknown) {
  return error instanceof V2PersistenceError && error.code === "database_unavailable";
}

function projectionErrorCode(error: unknown) {
  if (error instanceof V2PersistenceError) return error.code;
  return "projection_failed";
}

function canonicalResearchProgressBody(progress: Record<string, unknown>) {
  const generatedAt = String(progress.generatedAt ?? new Date().toISOString());
  const source = String(progress.source ?? (progress.databaseBacked === false ? "not_configured" : "postgresql"));
  const databaseBacked = progress.databaseBacked === undefined ? source === "postgresql" : Boolean(progress.databaseBacked);
  const degraded = progress.degraded === undefined ? progress.status === "degraded" : Boolean(progress.degraded);
  const reportingSource = {
    source,
    databaseBacked,
    degraded,
    generatedAt,
    projectionError: progress.projectionError ?? null,
  };
  return {
    ...progress,
    schemaVersion: progress.schemaVersion ?? "fincoach.v2.research-progress.1",
    status: progress.status ?? (degraded ? "degraded" : "ok"),
    generatedAt,
    source,
    reportingSource,
    databaseBacked,
    degraded,
    windows: ensureWindowContract(progress.windows as Record<string, Record<string, unknown>> | undefined),
    instrumentUniverse: progress.instrumentUniverse ?? validateResearchUniverse(loadV2RuntimeConfig().config.symbols),
    strategyTemplates: progress.strategyTemplates ?? strategyTemplateInventory(),
    liveExecutionBlocked: true,
  };
}

function ensureWindowContract(windows: Record<string, Record<string, unknown>> | undefined) {
  if (!windows) return {
    currentHour: { unavailable: true, reason: "postgres_projection_unavailable" },
    running24Hours: { unavailable: true, reason: "postgres_projection_unavailable" },
    running7Days: { unavailable: true, reason: "postgres_projection_unavailable" },
    lifetime: { unavailable: true, reason: "postgres_projection_unavailable" },
    total: { unavailable: true, reason: "postgres_projection_unavailable" },
  };
  const lifetime = windows.lifetime ?? windows.total ?? {};
  return {
    ...windows,
    currentHour: windows.currentHour ?? { unavailable: true, reason: "postgres_projection_unavailable" },
    running24Hours: windows.running24Hours ?? { unavailable: true, reason: "postgres_projection_unavailable" },
    running7Days: windows.running7Days ?? { unavailable: true, reason: "postgres_projection_unavailable" },
    lifetime,
    total: windows.total ?? lifetime,
  };
}

function applyPipelineCounts(body: Record<string, unknown>, pipeline: Record<string, unknown>) {
  body.observationsCreated = Number(pipeline.observations ?? 0);
  body.hypothesesCreated = Number(pipeline.hypotheses ?? 0);
  body.experimentsQueued = Number(pipeline.experiments ?? 0);
  body.backtestsCompleted = Number(pipeline.backtests ?? 0);
  body.courtroomVerdicts = Number(pipeline.verdicts ?? 0);
  body.rankedCandidates = Number(pipeline.rankedCandidates ?? 0);
  body.forwardTests = Number(pipeline.forwardTests ?? 0);
  body.signals = Number(pipeline.signals ?? 0);
  body.externalEvaluations = Number(pipeline.evaluations ?? 0);
  body.journalEntries = Number(pipeline.journalEntries ?? 0);
  body.lessons = Number(pipeline.lessons ?? 0);
  body.lifecycleStates = Number(pipeline.lifecycleDecisions ?? 0);
}

function markDurableCountsUnavailable(body: Record<string, unknown>, reason: string) {
  for (const key of [
    "observationsCreated",
    "hypothesesCreated",
    "experimentsQueued",
    "backtestsCompleted",
    "courtroomVerdicts",
    "rankedCandidates",
    "forwardTests",
    "signals",
    "externalEvaluations",
    "journalEntries",
    "lessons",
    "lifecycleStates",
  ]) {
    body[key] = null;
  }
  body.durableCounts = { state: "unavailable", projectionError: reason };
}

function applyPipelineAvailability(moduleAvailability: Record<string, V2OperationsAvailability>, pipeline: Record<string, unknown>) {
  const mappings: Array<[V2OperationsCollection, string]> = [
    ["observations", "observations"],
    ["hypotheses", "hypotheses"],
    ["strategies", "strategies"],
    ["experiments", "experiments"],
    ["backtests", "backtests"],
    ["court-cases", "verdicts"],
    ["forward-tests", "forwardTests"],
    ["signals", "signals"],
    ["evaluations", "evaluations"],
    ["journal", "journalEntries"],
    ["lessons", "lessons"],
    ["lifecycle", "lifecycleDecisions"],
  ];
  for (const [collection, key] of mappings) {
    moduleAvailability[collection] = Number(pipeline[key] ?? 0) > 0 ? "available" : "available_empty";
  }
}

function operatorAvailabilityState(state: string) {
  return state === "available_empty" ? "configured_empty" : state;
}

function isValidReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isAcceptableReportDate(value: string, now = new Date()) {
  if (!isValidReportDate(value)) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Date.parse(`${value}T00:00:00.000Z`) <= today.getTime() + 24 * 60 * 60_000;
}

function redactDestination(destination: string) {
  return createHash("sha256").update(destination).digest("hex").slice(0, 16);
}

function deliveryErrorCode(error: string | undefined) {
  if (!error) return "delivery_failed";
  if (/rate.?limit|429/i.test(error)) return "rate_limited";
  if (/timeout/i.test(error)) return "timeout";
  if (/not configured|missing/i.test(error)) return "not_configured";
  return "delivery_failed";
}

async function countEvidence(repository: EvidenceProjectionRepository | undefined) {
  if (!repository) return 0;
  return (await repository.listPage({ limit: 1, offset: 0 })).total;
}

function commandToCollection(command: string): V2OperationsCollection | null {
  return ({
    "/observations": "observations",
    "/hypotheses": "hypotheses",
    "/experiments": "experiments",
    "/backtests": "backtests",
    "/court_cases": "court-cases",
    "/forward_tests": "forward-tests",
    "/signals": "signals",
    "/evaluator_results": "evaluations",
    "/lessons": "lessons",
    "/strategy_health": "lifecycle",
  } as Record<string, V2OperationsCollection | undefined>)[command] ?? null;
}

function commandLabel(command: string, collection: V2OperationsCollection) {
  if (command === "/strategy_leaderboard") return "strategy leaderboard";
  if (command === "/forward_tests") return "forward tests";
  return collection;
}

function formatCoverage(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "none";
  return value.map(item => typeof item === "object" && item !== null ? `${(item as { value?: unknown }).value}:${(item as { count?: unknown }).count}` : String(item)).join(", ");
}

function formatCounts(counts: Record<string, number> | undefined) {
  if (!counts || !Object.keys(counts).length) return "none";
  return Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key}:${value}`).join(", ");
}

function formatConcentration(value: Record<string, unknown> | undefined) {
  if (!value) return "none";
  return `${value.key ?? "unknown"} ${value.count ?? 0} (${value.percentage ?? 0}%)`;
}

function formatWindowRows(windows: Record<string, Record<string, unknown>>) {
  const row = (label: string, key: string) => `${label}: ${windows.currentHour?.[key] ?? 0} / ${windows.running24Hours?.[key] ?? 0} / ${windows.running7Days?.[key] ?? 0} / ${windows.lifetime?.[key] ?? windows.total?.[key] ?? 0}`;
  return [
    row("Observations", "observations"),
    row("Hypotheses", "hypotheses"),
    row("Strategies", "strategies"),
    row("Experiments", "experiments"),
    row("Backtests", "backtests"),
    row("Verdicts", "verdicts"),
    row("Ranked", "rankedCandidates"),
    row("Forward tests", "forwardTests"),
    row("Signals", "signals"),
    row("Evaluations", "evaluations"),
    row("Journal", "journalEntries"),
    row("Lessons", "lessons"),
    row("Lifecycle", "lifecycleDecisions"),
  ];
}

function reasonForAvailability(state: V2OperationsAvailability) {
  return ({
    available: "repository_bound_records_present",
    available_empty: "repository_bound_no_records",
    disabled: "module_disabled_by_configuration",
    blocked: "module_blocked_by_runtime_gate",
    degraded: "module_or_projection_degraded",
    stale: "module_data_stale",
    not_configured: "repository_not_injected",
    temporarily_unavailable: "dependency_temporarily_unavailable",
    schema_incompatible: "migration_or_schema_incompatible",
  } satisfies Record<V2OperationsAvailability, string>)[state];
}

export let v2OperationsService = new V2OperationsService();

export function configureV2OperationsService(service: V2OperationsService) {
  v2OperationsService = service;
  return v2OperationsService;
}
