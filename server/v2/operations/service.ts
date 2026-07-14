import { createHash, randomUUID } from "crypto";
import { createDomainEvent } from "../contracts";
import { orchestrationV2Service } from "../orchestration";
import { V2PersistenceError } from "../persistence/errors";
import type { V2DailyResearchReport, V2OperationsAvailability, V2OperationsCollection, V2OperationsQuery, V2OperationsResponse } from "./contracts";
import { V2OperationsEventTypes } from "./events";
import { InMemoryV2OperationsRepository, type DailyReportDeliveryRecord, type DailyReportRecord } from "./repository";
import type { DurableWorkerLease, ResearchCycleRecord } from "../orchestration/contracts";
import type { DemoResearchPilotRecord } from "../pilot/contracts";

type ProjectionRepositories = {
  operations?: DurableOperationsProjectionRepository | InMemoryV2OperationsRepository;
  orchestration?: OrchestrationProjectionRepository;
  pilot?: PilotProjectionRepository;
};

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

export class V2OperationsService {
  constructor(private readonly repositories: ProjectionRepositories = { operations: new InMemoryV2OperationsRepository() }) {}

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
      moduleAvailability: defaultAvailability(),
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
    };
    return { status: 200, body, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "status" })] };
  }

  async statusAsync(query: { correlationId?: string } = {}): Promise<V2OperationsResponse<Record<string, unknown>>> {
    const base = this.status(query);
    const body = { ...base.body };
    const moduleAvailability = { ...(body.moduleAvailability as Record<string, V2OperationsAvailability>) };
    const moduleHealth = { ...(body.moduleHealth as Record<string, string>) };
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
        const latestReport = await this.asyncOperationsRepository()?.latestReport();
        body.latestDailyReport = latestReport?.report ?? null;
        body.deliveryState = latestReport ? "available" : "available_empty";
        moduleAvailability.operations = latestReport ? "available" : "available_empty";
        moduleHealth.operations = "healthy";
        body.postgresqlHealth = "healthy";
      }
    } catch (error) {
      const availability = availabilityFromError(error);
      body.postgresqlHealth = availability;
      body.moduleHealth = { ...moduleHealth, operations: "degraded" };
      body.moduleAvailability = { ...moduleAvailability, operations: availability };
      body.degradedReason = error instanceof Error ? error.message : "operations projection unavailable";
      return { ...base, status: 200, body };
    }
    body.moduleHealth = moduleHealth;
    body.moduleAvailability = moduleAvailability;
    return { ...base, body };
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
    return this.recordDailyReportDelivery(reportId, { sent: input.sent, error: input.error, correlationId });
  }

  telegramSummary(command: string) {
    if (command === "/v2_status") {
      const status = this.status().body;
      return [`Version 2 Status`, `Health: ${(status.moduleHealth as Record<string, string>).orchestration}`, `Dead letters: ${status.deadLetterCount}`, `Kill switch: ${status.killSwitchState}`, `Live execution: blocked`].join("\n");
    }
    const collection = commandToCollection(command);
    if (!collection) return "Unsupported Version 2 operations command.";
    const list = this.list(collection, { limit: 5 }).body;
    return [`Version 2 ${collection}`, `Items: ${(list.pagination as { total: number }).total}`, `Availability: ${list.availability}`, `Live execution: blocked`].join("\n");
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

  private event(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "telemetry", correlationId, causationId: null, payload });
  }
}

function defaultAvailability(): Record<V2OperationsCollection | "operations" | "pilot", V2OperationsAvailability> {
  return { ...collectionAvailability, operations: "available_empty", pilot: "not_configured" };
}

function availabilityFromError(error: unknown): V2OperationsAvailability {
  if (error instanceof V2PersistenceError) {
    if (error.code === "database_unavailable") return "temporarily_unavailable";
    if (error.code === "migration_mismatch" || error.code === "unsupported_schema_version") return "schema_incompatible";
    if (error.code === "malformed_persisted_record") return "degraded";
  }
  return "degraded";
}

function redactDestination(destination: string) {
  return createHash("sha256").update(destination).digest("hex").slice(0, 16);
}

function commandToCollection(command: string): V2OperationsCollection | null {
  return ({
    "/research_today": "journal",
    "/observations": "observations",
    "/hypotheses": "hypotheses",
    "/experiments": "experiments",
    "/backtests": "backtests",
    "/court_cases": "court-cases",
    "/strategy_leaderboard": "strategies",
    "/forward_tests": "forward-tests",
    "/signals": "signals",
    "/evaluator_results": "evaluations",
    "/lessons": "lessons",
    "/strategy_health": "lifecycle",
  } as Record<string, V2OperationsCollection | undefined>)[command] ?? null;
}

export const v2OperationsService = new V2OperationsService();
