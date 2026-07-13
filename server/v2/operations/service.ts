import { createHash, randomUUID } from "crypto";
import { createDomainEvent } from "../contracts";
import { orchestrationV2Service } from "../orchestration";
import type { V2DailyResearchReport, V2OperationsCollection, V2OperationsQuery, V2OperationsResponse } from "./contracts";
import { V2OperationsEventTypes } from "./events";

const collections: Record<V2OperationsCollection, readonly Record<string, unknown>[]> = {
  observations: [{ observationId: "obs-demo-1", symbol: "EUR_USD", status: "recorded" }],
  hypotheses: [{ hypothesisId: "hyp-demo-1", status: "candidate" }],
  experiments: [{ experimentId: "exp-demo-1", status: "queued" }],
  backtests: [{ backtestId: "bt-demo-1", status: "completed" }],
  "court-cases": [{ courtCaseId: "court-demo-1", verdict: "watch" }],
  strategies: [{ strategyId: "strategy-demo-1", status: "candidate" }],
  "forward-tests": [{ forwardTestId: "forward-demo-1", status: "monitoring" }],
  signals: [{ signalId: "signal-demo-1", demoOnly: true, redacted: true }],
  evaluations: [{ evaluationId: "eval-demo-1", outcome: "open" }],
  journal: [{ journalEntryId: "journal-demo-1", immutable: true }],
  lessons: [{ lessonId: "lesson-demo-1", confidence: 0.8 }],
  models: [{ modelId: "model-demo-1", decisionAuthority: "none" }],
  lifecycle: [{ strategyId: "strategy-demo-1", state: "candidate" }],
  orchestration: [{ cycleId: "cycle-demo-1", status: "requested" }],
};

export class V2OperationsService {
  private readonly reports = new Map<string, V2DailyResearchReport>();

  status(query: { correlationId?: string } = {}): V2OperationsResponse<Record<string, unknown>> {
    const correlationId = query.correlationId ?? randomUUID();
    const orchestration = orchestrationV2Service.health();
    const body = {
      schemaVersion: "fincoach.v2.operations-status.1",
      correlationId,
      moduleHealth: { orchestration: orchestration.status, telegram: "healthy", api: "healthy" },
      latestSuccessfulCycle: null,
      latestFailedCycle: null,
      queueDepth: orchestration.queueDepth,
      deadLetterCount: orchestration.deadLetters,
      activeWorkerLeases: orchestration.activeWorkerLeases,
      observationsCreated: collections.observations.length,
      hypothesesCreated: collections.hypotheses.length,
      experimentsQueued: collections.experiments.length,
      backtestsCompleted: collections.backtests.length,
      courtroomVerdicts: collections["court-cases"].length,
      rankedCandidates: collections.strategies.length,
      forwardTests: collections["forward-tests"].length,
      signals: collections.signals.length,
      externalEvaluations: collections.evaluations.length,
      lessons: collections.lessons.length,
      lifecycleStates: collections.lifecycle.length,
      killSwitchState: "inactive",
      liveExecutionBlocked: true,
      postgresqlHealth: "unknown",
      providerHealth: "unknown",
    };
    return { status: 200, body, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "status" })] };
  }

  list(collection: V2OperationsCollection, query: V2OperationsQuery = {}): V2OperationsResponse<Record<string, unknown>> {
    const correlationId = query.correlationId ?? randomUUID();
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    if (limit < 1 || limit > 100 || offset < 0) {
      return { status: 400, body: { schemaVersion: "fincoach.v2.error.1", message: "Invalid pagination", liveExecutionBlocked: true }, events: [this.event(V2OperationsEventTypes.V2OperationsRequestRejected, correlationId, { reason: "invalid_pagination", collection })] };
    }
    const filtered = collections[collection].filter(item => {
      if (query.symbol && item.symbol !== query.symbol) return false;
      if (query.strategyId && item.strategyId !== query.strategyId) return false;
      if (query.status && item.status !== query.status && item.state !== query.status) return false;
      return true;
    });
    return {
      status: 200,
      body: {
        schemaVersion: "fincoach.v2.operations-list.1",
        collection,
        items: filtered.slice(offset, offset + limit),
        pagination: { limit, offset, total: filtered.length },
        correlationId,
        liveExecutionBlocked: true,
      },
      events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { kind: "list", collection })],
    };
  }

  dailyReport(input: { reportDate: string; correlationId?: string }): V2OperationsResponse<{ status: "created" | "existing"; report: V2DailyResearchReport }> {
    const correlationId = input.correlationId ?? randomUUID();
    const existing = this.reports.get(input.reportDate);
    if (existing) return { status: 200, body: { status: "existing", report: existing }, events: [this.event(V2OperationsEventTypes.V2OperationsResponseCreated, correlationId, { reportId: existing.reportId, status: "existing" })] };
    const report: V2DailyResearchReport = {
      reportId: createHash("sha256").update(input.reportDate).digest("hex").slice(0, 32),
      schemaVersion: "fincoach.v2.daily-research-report.1",
      reportDate: input.reportDate,
      observations: collections.observations.length,
      hypotheses: collections.hypotheses.length,
      experiments: collections.experiments.length,
      backtests: collections.backtests.length,
      courtVerdicts: collections["court-cases"].length,
      rankingChanges: collections.strategies.length,
      forwardTests: collections["forward-tests"].length,
      signals: collections.signals.length,
      externalEvaluations: collections.evaluations.length,
      lessons: collections.lessons.length,
      lifecycleChanges: collections.lifecycle.length,
      operationalFailures: 0,
      deadLetterEvents: orchestrationV2Service.health().deadLetters,
      dataGaps: 0,
      staleDataIncidents: 0,
      moduleHealth: { orchestration: orchestrationV2Service.health().status },
      liveExecutionBlocked: true,
      createdAt: new Date().toISOString(),
    };
    this.reports.set(input.reportDate, report);
    return { status: 201, body: { status: "created", report }, events: [this.event(V2OperationsEventTypes.V2DailyReportCreated, correlationId, { reportId: report.reportId })] };
  }

  recordDailyReportDelivery(reportId: string, input: { sent: boolean; error?: string; correlationId?: string }) {
    const correlationId = input.correlationId ?? randomUUID();
    return { events: [this.event(input.sent ? V2OperationsEventTypes.V2DailyReportDelivered : V2OperationsEventTypes.V2DailyReportDeliveryFailed, correlationId, { reportId, error: input.error ?? null })] };
  }

  telegramSummary(command: string) {
    if (command === "/v2_status") {
      const status = this.status().body;
      return [`Version 2 Status`, `Health: ${(status.moduleHealth as Record<string, string>).orchestration}`, `Dead letters: ${status.deadLetterCount}`, `Kill switch: ${status.killSwitchState}`, `Live execution: blocked`].join("\n");
    }
    const collection = commandToCollection(command);
    if (!collection) return "Unsupported Version 2 operations command.";
    const list = this.list(collection, { limit: 5 }).body;
    return [`Version 2 ${collection}`, `Items: ${(list.pagination as { total: number }).total}`, `Live execution: blocked`].join("\n");
  }

  private event(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "telemetry", correlationId, causationId: null, payload });
  }
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
