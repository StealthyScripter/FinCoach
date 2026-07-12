import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { backtestRequestSchema, complianceAcknowledgementSubmissionSchema, journalReviewSubmissionSchema, optionsSimulationRequestSchema, paperTradeCloseRequestSchema, paperTradeFillRequestSchema, predictionReviewSubmissionSchema, quizSubmissionSchema, riskSettingsUpdateSchema, tradeTicketProposalSchema, tradingAssistantRequestSchema } from "@shared/schema";
import { researchService } from "./researchService";
import { simulationService, type ScenarioName } from "./simulationService";
import { portfolioModelService } from "./portfolioModelService";
import { eventCalendarService } from "./eventCalendarService";
import { optionsSimulationService } from "./optionsSimulationService";
import { agentOrchestrationService } from "./agentOrchestrationService";
import { alertService } from "./alertService";
import { brokerReadinessService } from "./brokerReadinessService";
import { liveAssistancePolicyService } from "./liveAssistancePolicyService";
import { complianceAuditService } from "./complianceAuditService";
import { portfolioRiskAnalyticsService } from "./portfolioRiskAnalyticsService";
import { backtestingService } from "./backtestingService";
import { ingestionService } from "./ingestionService";
import { marketBriefingWorkflowService } from "./marketBriefingWorkflowService";
import { evaluationService } from "./evaluationService";
import { verificationQualityService } from "./verificationQualityService";
import { agentSupervisorService } from "./agentSupervisorService";
import { securityPostureService } from "./securityPostureService";
import { getStorageHealth } from "./storageMode";
import { providerRegistryService } from "./providerRegistryService";
import { agentMemoryService } from "./memoryService";
import { eventLogService } from "./eventLogService";
import { metricsService, renderPrometheusMetrics } from "./metricsService";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { knowledgeGraphArchiveService } from "./knowledgeGraphArchiveService";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { institutionalAnalyticsArchiveService } from "./institutionalAnalyticsArchiveService";
import { modelValidationBenchmarkService } from "./modelValidationBenchmarkService";
import { traceService } from "./traceService";
import { otelTraceService } from "./otelTraceService";
import { aiProvider } from "./aiProviderService";
import { supervisorRuntime } from "./supervisorRuntimeService";
import { ragContextBuilder } from "./ragService";
import { vectorStore } from "./vectorStoreService";
import { cacheStore } from "./cacheStoreService";
import { timeSeriesStore } from "./timeSeriesStoreService";
import { publicProviderAdapters } from "./publicProviderAdapters";
import { ingestionRunnerService } from "./ingestionRunnerService";
import { eventLogStore } from "./eventLogStoreService";
import { aiEvaluationHarness } from "./aiEvaluationHarness";
import { aiResearchDraftService } from "./aiResearchDraftService";
import { informationRelevanceFilter } from "./informationRelevanceFilter";
import { marketMoveInvestigationService } from "./marketMoveInvestigationService";
import { predictionReviewService } from "./predictionReviewService";
import { signalPriorityService } from "./signalPriorityService";
import { strategySuggestionService } from "./strategySuggestionService";
import { tradingAssistantService } from "./tradingAssistantService";
import { createApiRateLimiter } from "./rateLimit";
import { INSTRUMENTS, strategyDefinitionSchema } from "./execution/domain";
import { marketBacktestRequestSchema, marketBacktestingService } from "./execution/marketBacktesting";
import { tradingViewWebhookProvider } from "./execution/tradingViewWebhook";
import { paperAutomationService } from "./execution/paperAutomation";
import { paperExecutionProvider } from "./execution/providers";
import { DEFAULT_AUTONOMY_POLICY, executionAuditLog, executionRiskService, summarizePositions } from "./execution/riskControls";
import { evaluateLiveReadiness } from "./execution/liveReadiness";
import { AUTOMATION_LEVEL_ACKNOWLEDGEMENT, automationLevelSchema, automationLevelService } from "./execution/automationLevels";
import { strategyValidationInputSchema } from "./execution/strategyValidation";
import { executionRiskPrecheckService } from "./execution/riskPrecheck";
import { brokerConnectionReadinessService } from "./execution/brokerConnectionReadiness";
import { selectExecutionCenterData } from "./execution/executionCenter";
import { LIVE_SAFETY_QUIZ } from "./execution/liveSafetyQuiz";
import {
  controlledLiveWorkflowService,
  controlledPreviewRequestSchema,
  finalConfirmationRequestSchema,
  livePermissionRequestSchema,
  sandboxSubmitRequestSchema,
} from "./execution/controlledLiveWorkflow";
import { liveTradingPermissionService } from "./execution/liveTradingPermission";
import { liveReadinessReportService } from "./execution/liveReadinessReport";
import { EmergencyControlService } from "./execution/emergencyControls";
import { sandboxBrokerAdapters } from "./execution/sandboxAdapters";
import { sandboxBrokerRuntime, sandboxConfirmedSubmitSchema, sandboxIdempotencyResolutionSchema, sandboxPreviewSchema, sandboxProviderSchema } from "./execution/sandboxBrokerRuntime";
import { SandboxBrokerError } from "./execution/brokerFailures";
import { demoOnlyPolicyService, DemoOnlyPolicyError } from "./execution/demoOnlyPolicy";
import { accountSyncService } from "./execution/accountSyncService";
import { selectSandboxExecutionCenterData } from "./execution/sandboxExecutionCenter";
import { sandboxExecutionMetrics } from "./execution/sandboxMetrics";
import { liveDataPaperOpsRuntime, operationalStrategySchema } from "./execution/liveDataPaperOpsRuntime";
import { selectStrategyPerformanceDashboard } from "./execution/strategyPerformanceDashboard";
import { economicEventRiskService } from "./execution/economicEventRiskService";
import { paperStrategyRuntime } from "./execution/paperStrategyRuntime";
import { strategyAdaptationService } from "./execution/strategyAdaptationService";
import { postTradeReviewService } from "./execution/postTradeReviewService";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { z } from "zod";
import { MetaTraderBridgePriceFeedProvider, OandaPracticePriceFeedProvider, priceFeedService } from "./execution/priceFeedService";
import { strategyLifecycleMonitorService } from "./execution/strategyLifecycleMonitorService";
import { marketSessionRulesService } from "./execution/marketSessionRules";
import { reliabilityStateStore } from "./execution/reliabilityStateStore";
import { providerRecoveryTelemetry } from "./execution/providerRecoveryTelemetry";
import { productionResilienceService } from "./execution/productionResilience";
import { productionResilienceEvidenceSchema, productionResilienceEvidenceService } from "./execution/productionResilienceEvidence";
import {
  semiAutonomousApprovalService,
  semiAutonomousRequestSchema,
  semiAutonomousReviewSchema,
} from "./execution/semiAutonomousApprovalService";
import { strategyLabService } from "./execution/strategyLabService";
import { auditExportService } from "./execution/auditExportService";
import { telegramBotService } from "./telegramService";
import { registerTelegramOperationsRoutes } from "./telegram";
import { demoRunService } from "./demoRunService";
import { strategyResearchSchedulerService } from "./strategyResearchSchedulerService";
import { historicalDataImportService } from "./historicalDataImportService";
import { researchAccelerationService } from "./researchAccelerationService";
import { oandaHistoricalBackfillService } from "./historicalDataBackfillService";

const emergencyControlService = new EmergencyControlService(
  executionRiskService,
  automationLevelService,
  [paperExecutionProvider, ...Object.values(sandboxBrokerAdapters)],
);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const tradingViewRateLimiter = createApiRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: "tradingview-webhook",
  });
  const telegramRateLimiter = createApiRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    keyPrefix: "telegram-webhook",
  });

  app.get("/api/health", async (_req, res) => {
    const storageHealth = getStorageHealth();
    const providers = providerRegistryService.getSnapshot();
    res.json({
      status: storageHealth.status === "unavailable" ? "degraded" : "healthy",
      generatedAt: new Date().toISOString(),
      storageMode: storageHealth.mode,
      providers: providers.providers.length,
      liveExecutionBlocked: true,
    });
  });

  app.get("/api/health/storage", async (_req, res) => {
    res.json(getStorageHealth());
  });

  app.get("/api/health/providers", async (_req, res) => {
    res.json(providerRegistryService.getSnapshot());
  });

  registerTelegramOperationsRoutes(app);

  app.get("/api/marketpilot/demo-run/status", async (_req, res) => {
    res.json(await demoRunService.status());
  });

  app.get("/api/marketpilot/demo-run/telemetry", async (_req, res) => {
    res.json(await demoRunService.telemetry());
  });

  app.get("/api/marketpilot/demo-run/report", async (_req, res) => {
    res.json(await demoRunService.report());
  });

  app.get("/api/marketpilot/demo-run/export", async (_req, res) => {
    res.json(await demoRunService.export());
  });

  app.get("/api/marketpilot/research-pipeline/status", async (_req, res) => {
    res.json(strategyResearchSchedulerService.snapshot());
  });

  app.post("/api/marketpilot/research-pipeline/history/import-csv", async (req, res) => {
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    const defaultInstrument = typeof req.body?.instrument === "string" ? req.body.instrument : undefined;
    const defaultTimeframe = typeof req.body?.timeframe === "string" ? req.body.timeframe : undefined;
    if (!csv.trim()) {
      res.status(400).json({ message: "CSV payload is required" });
      return;
    }
    try {
      res.json(historicalDataImportService.importCsv({ csv, defaultInstrument, defaultTimeframe: defaultTimeframe as never }));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Historical CSV import failed" });
    }
  });

  app.get("/api/marketpilot/research-pipeline/history/coverage", async (_req, res) => {
    res.json(researchAccelerationService.coverage());
  });

  app.post("/api/marketpilot/research-pipeline/history/import-oanda", async (req, res) => {
    const instruments = Array.isArray(req.body?.instruments) ? req.body.instruments.filter((item: unknown): item is string => typeof item === "string") : undefined;
    const timeframes = Array.isArray(req.body?.timeframes) ? req.body.timeframes.filter((item: unknown): item is never => typeof item === "string") : undefined;
    const count = typeof req.body?.count === "number" ? req.body.count : undefined;
    res.json(await researchAccelerationService.importOanda({ instruments, timeframes, count }));
  });

  app.post("/api/marketpilot/research-pipeline/history/backfill-oanda", async (req, res) => {
    const instruments = Array.isArray(req.body?.instruments) ? req.body.instruments.filter((item: unknown): item is string => typeof item === "string") : undefined;
    const timeframes = Array.isArray(req.body?.timeframes) ? req.body.timeframes.filter((item: unknown): item is never => typeof item === "string") : undefined;
    const maxCandlesPerRequest = typeof req.body?.maxCandlesPerRequest === "number" ? req.body.maxCandlesPerRequest : undefined;
    const maxRequestsPerRun = typeof req.body?.maxRequestsPerRun === "number" ? req.body.maxRequestsPerRun : undefined;
    const rateLimitMs = typeof req.body?.rateLimitMs === "number" ? req.body.rateLimitMs : undefined;
    try {
      res.json(await oandaHistoricalBackfillService.backfillOanda({
        instruments,
        timeframes,
        start: typeof req.body?.start === "string" ? req.body.start : undefined,
        end: typeof req.body?.end === "string" ? req.body.end : undefined,
        maxCandlesPerRequest,
        maxRequestsPerRun,
        rateLimitMs,
        dryRun: req.body?.dryRun === true,
        resume: req.body?.resume !== false,
      }));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "OANDA historical backfill failed" });
    }
  });

  app.get("/api/marketpilot/research-pipeline/history/backfill-status", async (_req, res) => {
    res.json({
      status: oandaHistoricalBackfillService.status(),
      acquisitionPlan: oandaHistoricalBackfillService.acquisitionPlan(),
    });
  });

  app.post("/api/marketpilot/research-pipeline/history/backfill-stop", async (_req, res) => {
    res.json(oandaHistoricalBackfillService.stop());
  });

  app.post("/api/marketpilot/research-pipeline/replay/run", async (req, res) => {
    const instruments = Array.isArray(req.body?.instruments) ? req.body.instruments.filter((item: unknown): item is string => typeof item === "string") : undefined;
    const timeframe = typeof req.body?.timeframe === "string" ? req.body.timeframe as never : undefined;
    res.json(researchAccelerationService.runReplay({ instruments, timeframe }));
  });

  app.get("/api/marketpilot/research-pipeline/replay/status", async (_req, res) => {
    res.json(researchAccelerationService.replayStatus());
  });

  app.get("/api/marketpilot/research-pipeline/replay/report", async (_req, res) => {
    res.json(researchAccelerationService.replayReport());
  });

  app.get("/api/marketpilot/research-pipeline/stability", async (_req, res) => {
    res.json(researchAccelerationService.stabilitySnapshot());
  });

  app.post("/api/marketpilot/research-pipeline/tick", async (_req, res) => {
    const status = await demoRunService.status();
    res.json(await strategyResearchSchedulerService.runOnce({ runState: status.state }));
  });

  app.post("/api/marketpilot/demo-run/start", async (_req, res) => {
    res.json(await demoRunService.start());
  });

  app.post("/api/marketpilot/demo-run/pause", async (_req, res) => {
    res.json(await demoRunService.pause());
  });

  app.post("/api/marketpilot/demo-run/resume", async (_req, res) => {
    res.json(await demoRunService.resume());
  });

  app.post("/api/marketpilot/demo-run/stop", async (_req, res) => {
    res.json(await demoRunService.stop());
  });

  app.post("/api/marketpilot/demo-run/screen-visit", async (req, res) => {
    const screen = typeof req.body?.screen === "string" ? req.body.screen : "";
    if (screen.trim()) await demoRunService.recordScreenVisit(screen);
    res.json({ accepted: true, screen: screen.trim() || null });
  });

  app.get("/api/marketpilot/connectors", async (_req, res) => {
    res.json(telegramBotService.connectorRegistry());
  });

  app.get("/api/health/security", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const brokerReadiness = brokerReadinessService.evaluate(overview);
    const livePolicy = liveAssistancePolicyService.evaluate({ overview, brokerReadiness });
    res.json(securityPostureService.evaluate({
      overview,
      brokerReadiness,
      livePolicy,
      rateLimiterEnabled: true,
    }));
  });

  app.get("/api/health/supervisor", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const report = agentSupervisorService.review(overview);
    res.json(report);
  });

  app.get("/api/metrics", async (_req, res) => {
    res.json(await loadMetricsSnapshot());
  });

  app.get("/api/metrics/prometheus", async (_req, res) => {
    const snapshot = await loadMetricsSnapshot();
    res.type("text/plain; version=0.0.4; charset=utf-8").send(renderPrometheusMetrics(snapshot));
  });

  app.get("/api/marketpilot/event-log", async (_req, res) => {
    res.json(eventLogService.snapshot());
  });

  app.get("/api/marketpilot/event-log/export", async (_req, res) => {
    res.type("text/plain; charset=utf-8").send(eventLogService.exportJsonLines());
  });

  app.get("/api/marketpilot/memory/health", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    await agentMemoryService.hydrateFromOverview(overview);
    res.json(agentMemoryService.health());
  });

  app.get("/api/marketpilot/memory/recall", async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      res.status(400).json({ message: "query is required" });
      return;
    }
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 3;
    const overview = await storage.getMarketPilotOverview();
    await agentMemoryService.hydrateFromOverview(overview);
    res.json({
      generatedAt: new Date().toISOString(),
      query,
      items: agentMemoryService.recall(query, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10) : 3),
    });
  });

  app.get("/api/marketpilot/ai/status", async (_req, res) => {
    res.json(aiProvider.health());
  });

  app.get("/api/marketpilot/supervisor/runtime", async (_req, res) => {
    res.json(supervisorRuntime.snapshot(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/rag/context", async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query : "market risk verification";
    res.json(await ragContextBuilder.build(await storage.getMarketPilotOverview(), query));
  });

  app.get("/api/marketpilot/rag/archive", async (_req, res) => {
    const [runs, documents] = await Promise.all([
      storage.getRagRuns(),
      storage.getRagDocuments(),
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      runs,
      documents,
    });
  });

  app.get("/api/marketpilot/ai/evaluations/archive", async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      evaluations: await storage.getAiEvaluations(),
    });
  });

  app.get("/api/marketpilot/vector-store/health", async (_req, res) => {
    res.json(vectorStore.health());
  });

  app.get("/api/marketpilot/vector-store/archive", async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      records: await vectorStore.list(100),
    });
  });

  app.get("/api/marketpilot/cache/health", async (_req, res) => {
    res.json(cacheStore.health());
  });

  app.get("/api/marketpilot/timeseries/health", async (_req, res) => {
    res.json(timeSeriesStore.health());
  });

  app.get("/api/marketpilot/timeseries/archive", async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      priceBars: await timeSeriesStore.listPriceBars(50),
      economicObservations: await timeSeriesStore.listEconomicObservations(50),
      optionsSnapshots: await timeSeriesStore.listOptionsSnapshots(50),
      ingestionRuns: await timeSeriesStore.listIngestionRuns(50),
    });
  });

  app.get("/api/marketpilot/public-providers/health", async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      providers: Object.values(publicProviderAdapters).map((provider) => provider.health()),
    });
  });

  app.post("/api/marketpilot/ingestion/run", async (req, res) => {
    const providers = Array.isArray(req.body?.providers) ? req.body.providers : undefined;
    const assets = Array.isArray(req.body?.assets) ? req.body.assets.filter((asset: unknown): asset is string => typeof asset === "string") : undefined;
    const dryRun = Boolean(req.body?.dryRun);
    res.status(201).json(await ingestionRunnerService.run({ providers, assets, dryRun }));
  });

  app.get("/api/marketpilot/ingestion/archive", async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      runs: await storage.getIngestionRuns(),
    });
  });

  app.get("/api/marketpilot/event-log-store/health", async (_req, res) => {
    res.json(eventLogStore.health());
  });

  app.get("/api/marketpilot/ai/evaluation", async (_req, res) => {
    res.json(aiEvaluationHarness.evaluate({
      output: {
        thesis: "Demo output",
        citations: [{ name: "demo" }],
        confidence: 72,
        riskFactors: ["Human review required"],
      },
      requiredFields: ["thesis", "citations", "confidence", "riskFactors"],
      citations: [{ name: "demo" }],
      confidence: 72,
      safetyNotes: ["Human review required; live trading blocked."],
      contradictoryEvidence: ["Demo contradiction"],
    }));
  });

  app.post("/api/marketpilot/ai/research-draft", async (req, res) => {
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "SPY";
    const overview = await storage.getMarketPilotOverview();
    const result = await aiResearchDraftService.generate(overview, symbol);
    await aiResearchDraftService.persistDraft(result, overview.user.id);
    res.status(201).json(result);
  });

  app.get("/api/marketpilot/knowledge-graph", async (req, res) => {
    const start = typeof req.query.start === "string" ? req.query.start : null;
    const overview = await storage.getMarketPilotOverview();
    const report = knowledgeGraphService.build(overview, start);
    knowledgeGraphArchiveService.record(report, overview);
    res.json(report);
  });

  app.get("/api/marketpilot/knowledge-graph/archive", async (_req, res) => {
    res.json({ events: knowledgeGraphArchiveService.latest() });
  });

  app.get("/api/marketpilot/analytics/institutional", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const snapshot = institutionalAnalyticsService.snapshot(overview);
    institutionalAnalyticsArchiveService.record(snapshot, overview);
    res.json(snapshot);
  });

  app.get("/api/marketpilot/analytics/archive", async (_req, res) => {
    res.json({ events: institutionalAnalyticsArchiveService.latest() });
  });

  app.get("/api/marketpilot/analytics/model-validation", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const report = modelValidationBenchmarkService.run(overview);
    modelValidationBenchmarkService.record(report, overview);
    res.json(report);
  });

  app.get("/api/marketpilot/analytics/model-validation/archive", async (_req, res) => {
    res.json({ events: modelValidationBenchmarkService.latest() });
  });

  app.get("/api/marketpilot/traces/:correlationId", async (req, res) => {
    const correlationId = String(req.params.correlationId || "").trim();
    if (!correlationId) {
      res.status(400).json({ message: "Correlation ID is required" });
      return;
    }
    res.json(await traceService.build(correlationId));
  });

  app.get("/api/marketpilot/traces/:correlationId/otel", async (req, res) => {
    const correlationId = String(req.params.correlationId || "").trim();
    if (!correlationId) {
      res.status(400).json({ message: "Correlation ID is required" });
      return;
    }
    res.json(await otelTraceService.build(correlationId));
  });

  app.get("/api/marketpilot/analytics/correlations", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json(institutionalAnalyticsService.correlation.analyze(overview.portfolio));
  });

  app.get("/api/marketpilot/analytics/factors", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json(institutionalAnalyticsService.factors.analyze(overview.portfolio));
  });

  app.get("/api/marketpilot/analytics/monte-carlo", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json(institutionalAnalyticsService.monteCarlo.run(overview.portfolio));
  });

  app.get("/api/marketpilot/analytics/stress-tests", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json(institutionalAnalyticsService.stress.run(overview.portfolio));
  });

  app.get("/api/marketpilot/analytics/greeks", async (_req, res) => {
    res.json(institutionalAnalyticsService.greeks.analyze("SPY"));
  });

  app.get("/api/marketpilot/analytics/regime", async (_req, res) => {
    res.json(institutionalAnalyticsService.regime.classify(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/analytics/consensus", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json(institutionalAnalyticsService.consensus.evaluate(agentOrchestrationService.generateOutputs(overview)));
  });

  app.get("/api/marketpilot/analytics/behavior", async (_req, res) => {
    res.json(institutionalAnalyticsService.behavior.evaluate(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/analytics/proficiency-graph", async (_req, res) => {
    res.json(institutionalAnalyticsService.proficiencyGraph.build(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/overview", async (_req, res) => {
    res.json(await storage.getMarketPilotOverview());
  });

  app.post("/api/marketpilot/assistant/ask", async (req, res) => {
    const parsed = tradingAssistantRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid assistant request",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const overview = await storage.getMarketPilotOverview();
    const response = await tradingAssistantService.respond(parsed.data, overview);
    eventLogService.append({
      type: "market.explanation_generated",
      userId: overview.user.id,
      sourceService: "trading-assistant-service",
      payload: {
        intent: response.intent,
        domain: response.domain,
        decisionCardId: response.decisionCard.id,
        predictionTrackingId: response.predictionTrackingId,
      },
    });
    res.status(201).json(response);
  });

  app.get("/api/marketpilot/assistant/opportunities", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const insight = predictionReviewService.insights(1);
    const memoryLesson = insight.topThemes[0]?.latestUpdatedLesson ?? insight.recentRules[0]?.updatedLesson ?? null;
    const ranked = signalPriorityService.rank([
      ...overview.researchReports.map((report) => ({
        id: `research-${report.id}`,
        title: report.title,
        category: "explanation" as const,
        summary: report.mainCause,
        relevanceToGoal: 75,
        marketImpact: report.agent === "macro" ? 80 : 65,
        confidence: report.confidence,
        freshness: 68,
        portfolioExposure: report.asset
          ? overview.portfolio.holdings.find((holding) => holding.symbol === report.asset)?.allocation ?? 0
          : 0,
        riskSeverity: report.riskFactors.length * 15,
        learningValue: 70,
        actionability: report.verification.status === "verified" ? 72 : 45,
        details: [...report.secondaryCauses, ...report.riskFactors],
      })),
      ...overview.tradeTickets.map((ticket) => ({
        id: `ticket-${ticket.id}`,
        title: `${ticket.asset} ${ticket.direction} idea`,
        category: ticket.status === "risk_rejected" ? "risk_warning" as const : "opportunity" as const,
        summary: ticket.rationale,
        relevanceToGoal: 82,
        marketImpact: 62,
        confidence: ticket.confidence,
        freshness: 65,
        portfolioExposure: overview.portfolio.holdings.find((holding) => holding.symbol === ticket.asset)?.allocation ?? 0,
        riskSeverity: 100 - ticket.riskCheck.score,
        learningValue: 66,
        actionability: ticket.status === "risk_rejected" ? 35 : 70,
        details: [...ticket.supportingEvidence, ...ticket.riskCheck.reasons],
      })),
    ], 12, { memoryLesson });

    res.json({
      primary: informationRelevanceFilter.primary(ranked),
      secondary: informationRelevanceFilter.secondary(ranked),
      advanced: informationRelevanceFilter.advanced(ranked),
      all: informationRelevanceFilter.visible(ranked),
    });
  });

  app.get("/api/marketpilot/assistant/investigate/:symbol", async (req, res) => {
    res.json(await marketMoveInvestigationService.investigate(req.params.symbol));
  });

  app.post("/api/marketpilot/assistant/strategy", async (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "Review this strategy";
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "SPY";
    const overview = await storage.getMarketPilotOverview();
    const explanation = await researchService.explainMove(symbol);
    res.status(201).json(strategySuggestionService.suggest({ prompt, explanation, overview }));
  });

  app.get("/api/marketpilot/assistant/predictions", async (_req, res) => {
    res.json(predictionReviewService.listPredictions());
  });

  app.get("/api/marketpilot/assistant/prediction-reviews", async (_req, res) => {
    res.json(predictionReviewService.listReviews());
  });

  app.get("/api/marketpilot/assistant/prediction-insights", async (_req, res) => {
    res.json(predictionReviewService.insights());
  });

  app.post("/api/marketpilot/assistant/prediction-reviews", async (req, res) => {
    const parsed = predictionReviewSubmissionSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid prediction review",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const overview = await storage.getMarketPilotOverview();
    const review = predictionReviewService.review(parsed.data);
    eventLogService.append({
      type: "journal.entry_created",
      userId: overview.user.id,
      sourceService: "prediction-review-service",
      payload: {
        predictionId: review.predictionId,
        shouldConfidenceModelChange: review.shouldConfidenceModelChange,
        shouldStrategyBeDowngraded: review.shouldStrategyBeDowngraded,
      },
    });
    res.status(201).json(review);
  });

  app.get("/api/marketpilot/learning", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    res.json({
      progression: overview.progression,
      proficiencyScores: overview.proficiencyScores,
      modules: await storage.getLearningModules(),
    });
  });

  app.post("/api/marketpilot/learning/quiz-results", async (req, res, next) => {
    const parsed = quizSubmissionSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid quiz result submission",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      res.status(201).json(await storage.submitQuizResult(parsed.data));
    } catch (error) {
      if (error instanceof Error && "status" in error && typeof error.status === "number") {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  app.get("/api/marketpilot/research", async (_req, res) => {
    res.json(await storage.getResearchReports());
  });

  app.get("/api/marketpilot/agents", async (_req, res) => {
    res.json(agentOrchestrationService.generateOutputs(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/agents/supervisor", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const report = agentSupervisorService.review(overview);
    eventLogService.append({
      type: "supervisor.workflow_completed",
      userId: overview.user.id,
      sourceService: "agent-service",
      payload: { ticketReviews: report.ticketReviews.length, mode: report.mode },
    });
    res.json(report);
  });

  app.get("/api/marketpilot/evaluations/current", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const agents = agentOrchestrationService.generateOutputs(overview);
    const portfolioRisk = portfolioRiskAnalyticsService.analyze(overview.portfolio);

    const report = evaluationService.evaluate({ overview, agents, portfolioRisk });
    eventLogService.append({
      type: "evaluation.completed",
      userId: overview.user.id,
      sourceService: "analytics-service",
      payload: { overallScore: report.overallScore, status: report.status },
    });
    res.json(report);
  });

  app.get("/api/marketpilot/verification/quality", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const report = verificationQualityService.evaluate(overview);
    eventLogService.append({
      type: "verification.completed",
      userId: overview.user.id,
      sourceService: "verification-service",
      payload: { score: report.score, status: report.status },
    });
    res.json(report);
  });

  app.get("/api/marketpilot/alerts", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const alerts = alertService.evaluateAlerts({
      overview,
      events: eventCalendarService.getUpcomingEvents(),
    });
    void Promise.all(alerts.map((alert) => telegramBotService.notifyAlert(alert)));
    res.json(alerts);
  });

  app.get("/api/marketpilot/ingestion/snapshot", async (_req, res) => {
    res.json(await ingestionService.getSnapshot());
  });

  app.get("/api/marketpilot/broker/readiness", async (_req, res) => {
    res.json(brokerReadinessService.evaluate(await storage.getMarketPilotOverview()));
  });

  app.get("/api/marketpilot/live/policy", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const brokerReadiness = brokerReadinessService.evaluate(overview);
    res.json(liveAssistancePolicyService.evaluate({ overview, brokerReadiness }));
  });

  app.get("/api/marketpilot/security/posture", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    const brokerReadiness = brokerReadinessService.evaluate(overview);
    const livePolicy = liveAssistancePolicyService.evaluate({ overview, brokerReadiness });

    const report = securityPostureService.evaluate({
      overview,
      brokerReadiness,
      livePolicy,
      rateLimiterEnabled: true,
    });
    eventLogService.append({
      type: "security.posture_updated",
      userId: overview.user.id,
      sourceService: "compliance-service",
      payload: { score: report.score, status: report.status },
    });
    res.json(report);
  });

  app.get("/api/marketpilot/compliance/profile", async (_req, res) => {
    res.json(await storage.getComplianceProfile());
  });

  app.post("/api/marketpilot/compliance/acknowledgement", async (req, res) => {
    const parsed = complianceAcknowledgementSubmissionSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid compliance acknowledgement",
        issues: parsed.error.flatten(),
      });
      return;
    }

    res.status(201).json(await storage.acknowledgeCompliance(parsed.data));
  });

  app.get("/api/marketpilot/audit/compliance", async (req, res) => {
    const target = typeof req.query.target === "string" && req.query.target.length > 0
      ? req.query.target
      : null;
    const overview = await storage.getMarketPilotOverview();
    res.json(complianceAuditService.summarize({ events: overview.auditLogs, target }));
  });

  app.post("/api/marketpilot/research/briefing", async (req, res) => {
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "SPY";
    const report = await researchService.generateMarketBriefing(symbol);
    const saved = await storage.saveResearchReport(report);
    eventLogService.append({
      type: "research.report_generated",
      userId: (await storage.getMarketPilotOverview()).user.id,
      sourceService: "research-service",
      payload: { reportId: saved.id, asset: saved.asset ?? null, confidence: saved.confidence },
    });
    res.status(201).json(saved);
  });

  app.post("/api/marketpilot/research/scheduled-briefing", async (req, res) => {
    const symbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols.filter((symbol: unknown): symbol is string => typeof symbol === "string")
      : undefined;
    const briefing = await marketBriefingWorkflowService.run(symbols);
    const savedReports = [];

    for (const report of briefing.reports) {
      savedReports.push(await storage.saveResearchReport(report));
    }

    res.status(201).json({
      ...briefing,
      reports: savedReports,
    });
  });

  app.get("/api/marketpilot/explain/:symbol", async (req, res) => {
    const explanation = await researchService.explainMove(req.params.symbol);
    const overview = await storage.getMarketPilotOverview();
    eventLogService.append({
      type: "market.explanation_generated",
      userId: overview.user.id,
      sourceService: "research-service",
      payload: { symbol: explanation.symbol, confidence: explanation.confidence },
    });
    res.json(explanation);
  });

  app.get("/api/marketpilot/risk", async (_req, res) => {
    res.json(await storage.getRiskRules());
  });

  app.get("/api/marketpilot/risk/settings", async (_req, res) => {
    res.json(await storage.getRiskSettings());
  });

  app.patch("/api/marketpilot/risk/settings", async (req, res) => {
    const parsed = riskSettingsUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid risk settings update",
        issues: parsed.error.flatten(),
      });
      return;
    }

    res.json(await storage.updateRiskSettings(parsed.data));
  });

  app.get("/api/marketpilot/events", async (_req, res) => {
    res.json(eventCalendarService.getUpcomingEvents());
  });

  app.get("/api/marketpilot/portfolio", async (_req, res) => {
    res.json(await storage.getPaperPortfolio());
  });

  app.get("/api/marketpilot/portfolio/models", async (_req, res) => {
    res.json(portfolioModelService.getRecommendations(await storage.getPaperPortfolio()));
  });

  app.get("/api/marketpilot/portfolio/risk-analytics", async (_req, res) => {
    res.json(portfolioRiskAnalyticsService.analyze(await storage.getPaperPortfolio()));
  });

  app.get("/api/marketpilot/simulations/:scenario", async (req, res) => {
    const scenario = req.params.scenario as ScenarioName;
    if (!["2008_crisis", "2020_covid_crash", "2022_rate_shock", "oil_shock"].includes(scenario)) {
      res.status(400).json({ message: "Unknown simulation scenario" });
      return;
    }

    const [portfolio, riskRules] = await Promise.all([
      storage.getPaperPortfolio(),
      storage.getRiskRules(),
    ]);
    res.json(simulationService.runScenario(portfolio, riskRules, scenario));
  });

  app.post("/api/marketpilot/backtests", async (req, res) => {
    const parsed = backtestRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid backtest request",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const result = backtestingService.run(parsed.data);
    strategyEvidenceStore.recordBacktestResult(parsed.data.strategyName, {
      verdict: result.maxDrawdownPct > 20 ? "watch" : result.sharpeRatio < 0 ? "retire" : "healthy",
      summary: `Backtest from ${result.startYear} to ${result.endYear} ended at ${result.finalValue}.`,
      symbol: parsed.data.allocation[0]?.symbol ?? null,
      regime: "backtest",
      evidence: result,
    });
    res.json(result);
  });

  app.post("/api/marketpilot/backtests/markets", async (req, res) => {
    const parsed = marketBacktestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid forex/commodity backtest", issues: parsed.error.flatten() });
      return;
    }
    const result = marketBacktestingService.run(parsed.data);
    strategyEvidenceStore.recordBacktestResult(parsed.data.strategyName, {
      verdict: result.maxDrawdownPct > 20 ? "watch" : "healthy",
      summary: `Market backtest completed for ${parsed.data.strategyName} on ${parsed.data.instrument}.`,
      symbol: parsed.data.instrument,
      regime: "market_backtest",
      evidence: result,
    });
    res.json(result);
  });

  app.post("/api/webhooks/tradingview", tradingViewRateLimiter, async (req, res) => {
    const result = tradingViewWebhookProvider.receive(req.body);
    res.status(result.accepted ? 202 : 400).json(result);
  });

  app.post("/api/telegram/webhook", telegramRateLimiter, async (req, res) => {
    const secretHeader = req.header("X-Telegram-Bot-Api-Secret-Token") ?? undefined;
    const result = await telegramBotService.handleWebhook(req.body, secretHeader);
    res.status(result.status).json({
      accepted: result.accepted,
      reason: result.reason ?? null,
      correlationId: result.correlationId,
      productionLiveExecutionBlocked: true,
    });
  });

  app.post("/api/telegram/set-webhook", async (_req, res) => {
    if (process.env.NODE_ENV === "production" && process.env.MARKETPILOT_ALLOW_TELEGRAM_WEBHOOK_SETUP !== "true") {
      res.status(403).json({ message: "Telegram webhook setup is disabled in production." });
      return;
    }
    const result = await telegramBotService.setWebhook();
    res.status(result.ok ? 201 : 400).json({
      ok: result.ok,
      reason: result.reason,
      productionLiveExecutionBlocked: true,
    });
  });

  app.get("/api/marketpilot/execution/instruments", async (_req, res) => {
    res.json(INSTRUMENTS);
  });

  app.get("/api/marketpilot/execution/strategies", async (_req, res) => {
    res.json(paperAutomationService.listStrategies());
  });

  app.post("/api/marketpilot/execution/strategies", async (req, res) => {
    const parsed = strategyDefinitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid strategy definition", issues: parsed.error.flatten() });
      return;
    }
    res.status(201).json(paperAutomationService.registerStrategy(parsed.data));
  });

  app.post("/api/marketpilot/execution/strategies/:id/validation", async (req, res) => {
    const parsed = strategyValidationInputSchema.safeParse({ ...req.body, strategyId: req.params.id });
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid strategy validation evidence", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(paperAutomationService.validateStrategy(parsed.data));
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Strategy validation failed" });
    }
  });

  app.post("/api/marketpilot/strategy-validation", async (req, res) => {
    const parsed = strategyValidationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid strategy validation request", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.json(paperAutomationService.validateStrategy(parsed.data));
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Strategy validation failed" });
    }
  });

  app.get("/api/marketpilot/strategy-lab", async (_req, res) => {
    const [overview, journalReviews] = await Promise.all([
      storage.getMarketPilotOverview(),
      storage.getJournalReviews(),
    ]);
    const strategies = paperAutomationService.listStrategies();
    const validations = paperAutomationService.listStrategyValidations();
    const validationInputs = paperAutomationService.listStrategyValidationInputs();
    const closedTrades = paperStrategyRuntime.listClosed();
    const postTradeReviews = postTradeReviewService.list();
    const predictionReviews = predictionReviewService.listReviews();
    const adaptations = strategyAdaptationService.list();
    const lifecycleReports = strategyLifecycleMonitorService.list();
    res.json(strategyLabService.build({
      strategies,
      validationInputs,
      scorecards: validations,
      closedTrades,
      postTradeReviews,
      predictionReviews,
      journalReviews,
      adaptations,
      lifecycleReports,
    }, new Date(overview.auditLogs[0]?.createdAt ?? new Date().toISOString())));
  });

  app.get("/api/marketpilot/strategy-evidence", async (_req, res) => {
    res.json(strategyEvidenceStore.snapshot());
  });

  app.get("/api/marketpilot/strategy-evidence/export", async (_req, res) => {
    await strategyEvidenceStore.flushPersistence();
    res.type("text/plain; charset=utf-8").send(strategyEvidenceStore.exportJsonLines());
  });

  app.get("/api/marketpilot/execution/automation-level", async (_req, res) => {
    res.json({
      ...automationLevelService.snapshot(),
      semiAutonomousApproval: await semiAutonomousApprovalService.active(),
    });
  });

  app.post("/api/marketpilot/execution/automation-level", async (req, res) => {
    const parsed = automationLevelSchema.safeParse(req.body?.level);
    if (!parsed.success) {
      res.status(400).json({ message: "Automation level must be an integer from 0 through 6" });
      return;
    }
    const actorId = typeof req.body?.actorId === "string" ? req.body.actorId : "";
    const workflow = controlledLiveWorkflowService.snapshot(actorId || "unknown");
    const configuredProviders = sandboxBrokerRuntime.configuredProviders();
    const validations = paperAutomationService.listStrategyValidations();
    const risk = executionRiskService.snapshot();
    const activeSemiAutonomousApproval = await semiAutonomousApprovalService.active();
    const activeStrategyIds = liveDataPaperOpsRuntime.snapshot().strategyOps
      .filter((state) => state?.status === "active")
      .map((state) => state!.strategyId);
    const semiAutonomousScopeValid = Boolean(
      activeSemiAutonomousApproval
      && activeStrategyIds.every((strategyId) => activeSemiAutonomousApproval.scope.strategyIds.includes(strategyId))
      && activeSemiAutonomousApproval.scope.maxDailyLoss <= risk.maxDailyLoss
      && activeSemiAutonomousApproval.scope.sandboxOnly
    );
    const auditHealth = auditExportService.health();
    const transition = automationLevelService.requestTransition({
      targetLevel: parsed.data,
      actorId,
      acknowledgement: typeof req.body?.acknowledgement === "string" ? req.body.acknowledgement : "",
      registeredStrategyCount: paperAutomationService.listStrategies().length + liveDataPaperOpsRuntime.snapshot().strategyOps.length,
      validatedStrategyCount: validations.filter((item) => item.verdict !== "reject").length,
      constraintsConfigured: risk.maxDailyLoss > 0,
      monitoringEnabled: true,
      killSwitchAvailable: true,
      sandboxReady: configuredProviders.oandaPractice || configuredProviders.metaTraderDemo,
      supervisedPermissionActive: Boolean(
        workflow.permission?.allowed
        && Date.parse(workflow.permission.expirationTimestamp) > Date.now()
      ),
      semiAutonomousApproved: semiAutonomousScopeValid,
      auditExportReady: Boolean(
        auditHealth.signingConfigured
        && auditHealth.exportDirectoryConfigured
        && auditHealth.repository.durable
        && auditHealth.sourcePersistence.events.store?.provider === "postgres"
        && auditHealth.sourcePersistence.events.failureCount === 0
        && auditHealth.sourcePersistence.executionAudit.repository?.durable
        && auditHealth.sourcePersistence.executionAudit.failureCount === 0
      ),
      semiAutonomousScope: activeSemiAutonomousApproval?.scope ?? null,
    });
    await liveDataPaperOpsRuntime.enforceAutomationLevel();
    res.status(transition.changed ? 201 : 409).json({
      ...transition,
      requiredAcknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
      productionOrderSubmissionEnabled: false,
    });
  });

  app.post("/api/marketpilot/execution/semi-autonomous-approvals", async (req, res) => {
    const parsed = semiAutonomousRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid semi-autonomous approval request", issues: parsed.error.flatten() });
      return;
    }
    res.status(201).json(await semiAutonomousApprovalService.request(parsed.data));
  });

  app.post("/api/marketpilot/execution/semi-autonomous-approvals/:id/reviews", async (req, res) => {
    const parsed = semiAutonomousReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid semi-autonomous review", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await semiAutonomousApprovalService.review(req.params.id, parsed.data));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Approval review failed" });
    }
  });

  app.post("/api/marketpilot/execution/semi-autonomous-approvals/:id/revoke", async (req, res) => {
    try {
      const revoked = await semiAutonomousApprovalService.revoke(
        req.params.id,
        typeof req.body?.revokedBy === "string" ? req.body.revokedBy : "",
        typeof req.body?.reason === "string" ? req.body.reason : "",
      );
      if (automationLevelService.snapshot().level === 6) {
        automationLevelService.setLevel(0);
        await liveDataPaperOpsRuntime.enforceAutomationLevel();
      }
      res.status(201).json(revoked);
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Approval revocation failed" });
    }
  });

  app.get("/api/marketpilot/execution/semi-autonomous-approvals", async (_req, res) => {
    res.json({
      approvals: await semiAutonomousApprovalService.list(),
      active: await semiAutonomousApprovalService.active(),
      repository: semiAutonomousApprovalService.health(),
      productionOrderSubmissionEnabled: false,
    });
  });

  app.post("/api/marketpilot/execution/audit-exports", async (req, res) => {
    try {
      const result = await auditExportService.generate(
        typeof req.body?.generatedBy === "string" ? req.body.generatedBy : "",
      );
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Audit export failed" });
    }
  });

  app.get("/api/marketpilot/execution/audit-exports", async (_req, res) => {
    res.json({
      exports: await auditExportService.list(),
      health: auditExportService.health(),
    });
  });

  app.get("/api/marketpilot/execution/audit-exports/:id", async (req, res) => {
    const bundle = await auditExportService.get(req.params.id);
    if (!bundle) {
      res.status(404).json({ message: "Audit export not found" });
      return;
    }
    res.json({
      ...bundle,
      productionOrderSubmissionEnabled: false,
    });
  });

  app.post("/api/marketpilot/execution/audit-exports/verify", async (req, res) => {
    const artifact = req.body?.artifact;
    const digest = typeof req.body?.digest === "string" ? req.body.digest : "";
    const signature = typeof req.body?.signature === "string" ? req.body.signature : null;
    if (!artifact || artifact.format !== "marketpilot-audit-export-v1" || !digest) {
      res.status(400).json({ message: "artifact and digest are required" });
      return;
    }
    res.json(auditExportService.verify(artifact, digest, signature));
  });

  app.post("/api/marketpilot/execution/paper/signals", async (req, res) => {
    const signal = req.body?.signal;
    const strategyId = typeof req.body?.strategyId === "string" ? req.body.strategyId : "";
    const parsed = strategyDefinitionSchema.shape.id.safeParse(strategyId);
    if (!parsed.success || !signal || typeof signal !== "object") {
      res.status(400).json({ message: "strategyId and signal are required" });
      return;
    }
    const result = await paperAutomationService.executeSignal(signal, strategyId);
    res.status(result.status === "paper strategy created" ? 201 : 400).json(result);
  });

  app.get("/api/marketpilot/execution/live-safety-quiz", async (_req, res) => {
    res.json(LIVE_SAFETY_QUIZ.map(({ correctChoice: _correctChoice, explanation: _explanation, ...question }) => question));
  });

  app.post("/api/marketpilot/execution/live-safety-quiz", async (req, res) => {
    const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
    const answers = req.body?.answers;
    if (!userId || !answers || typeof answers !== "object" || Array.isArray(answers)) {
      res.status(400).json({ message: "userId and answer map are required" });
      return;
    }
    res.status(201).json(controlledLiveWorkflowService.gradeQuiz(userId, answers));
  });

  app.post("/api/marketpilot/execution/live-permission", async (req, res) => {
    const parsed = livePermissionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid demo readiness evidence", issues: parsed.error.flatten() });
      return;
    }
    const policy = demoOnlyPolicyService.check({
      provider: "controlled_live_workflow",
      accountMode: parsed.data.accountMode,
      verificationSource: "controlledLiveWorkflow.permissionRequest",
      attemptedAction: "controlled_live.permission",
      actor: parsed.data.userId,
      source: "routes",
    });
    if (policy.blocked) {
      demoOnlyPolicyService.recordBlocked({
        provider: "controlled_live_workflow",
        accountMode: parsed.data.accountMode,
        verificationSource: "controlledLiveWorkflow.permissionRequest",
        attemptedAction: "controlled_live.permission",
        actor: parsed.data.userId,
        source: "routes",
      }, policy);
      res.status(403).json(policy);
      return;
    }
    const permission = controlledLiveWorkflowService.evaluatePermission(parsed.data);
    res.status(permission.allowed ? 201 : 409).json(permission);
  });

  app.get("/api/marketpilot/execution/controlled-live-workflow", async (req, res) => {
    const userId = typeof req.query.userId === "string" && req.query.userId.trim() ? req.query.userId : "demo-user";
    res.json(controlledLiveWorkflowService.snapshot(userId));
  });

  app.get("/api/marketpilot/execution/controlled-live-workflow/history", async (req, res) => {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    const previewId = typeof req.query.previewId === "string" ? req.query.previewId : null;
    const correlationId = typeof req.query.correlationId === "string" ? req.query.correlationId : null;
    res.json(await controlledLiveWorkflowService.history({
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 25,
      userId,
      previewId,
      correlationId,
    }));
  });

  app.post("/api/marketpilot/execution/live-order-preview", async (req, res) => {
    const parsed = controlledPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid demo readiness order preview", issues: parsed.error.flatten() });
      return;
    }
    try {
      demoOnlyPolicyService.assertAllowed({
        provider: parsed.data.provider,
        accountMode: "unverified",
        verificationSource: "controlledLiveWorkflow.previewRequest",
        attemptedAction: "controlled_live.order_preview",
        actor: "demo-user",
        source: "routes",
      });
      res.status(201).json(controlledLiveWorkflowService.createPreview(parsed.data));
    } catch (error) {
      if (error instanceof DemoOnlyPolicyError) {
        res.status(403).json(error.result);
        return;
      }
      res.status(400).json({ message: error instanceof Error ? error.message : "Preview creation failed" });
    }
  });

  app.post("/api/marketpilot/execution/live-final-confirmation", async (req, res) => {
    const parsed = finalConfirmationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid final confirmation", issues: parsed.error.flatten() });
      return;
    }
    try {
      demoOnlyPolicyService.assertAllowed({
        provider: "controlled_live_workflow",
        accountMode: "unverified",
        verificationSource: "controlledLiveWorkflow.finalConfirmation",
        attemptedAction: "controlled_live.final_confirmation",
        actor: parsed.data.userId,
        source: "routes",
      });
      const confirmation = controlledLiveWorkflowService.confirm(parsed.data);
      res.status(confirmation.accepted ? 201 : 409).json(confirmation);
    } catch (error) {
      if (error instanceof DemoOnlyPolicyError) {
        res.status(403).json(error.result);
        return;
      }
      res.status(404).json({ message: error instanceof Error ? error.message : "Confirmation failed" });
    }
  });

  app.post("/api/marketpilot/execution/sandbox-submit", async (req, res) => {
    const parsed = sandboxSubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid sandbox submission", issues: parsed.error.flatten() });
      return;
    }
    try {
      const order = await controlledLiveWorkflowService.submitSandbox(parsed.data);
      res.status(order.status === "sandbox_filled" ? 201 : 409).json(order);
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Sandbox submission failed" });
    }
  });

  app.get("/api/marketpilot/execution/sandbox/providers", async (_req, res) => {
    res.json(sandboxBrokerRuntime.configuredProviders());
  });

  app.get("/api/marketpilot/execution/sandbox-panel", async (req, res) => {
    const configured = sandboxBrokerRuntime.configuredProviders();
    const requested = sandboxProviderSchema.safeParse(req.query.provider);
    const provider = requested.success
      ? requested.data
      : configured.oandaPractice
        ? "oanda_practice" as const
        : configured.metaTraderDemo
          ? "metatrader_demo" as const
          : null;
    if (!provider) {
      res.json(selectSandboxExecutionCenterData({
        health: null,
        account: null,
        positions: [],
        latestOrder: sandboxBrokerRuntime.getLatestOrder(),
        killSwitchActive: executionRiskService.snapshot().globalKillSwitch,
        latestReconciliation: sandboxBrokerRuntime.reconciliationReports()[0] ?? null,
      }));
      return;
    }
    try {
      const adapter = sandboxBrokerRuntime.adapter(provider);
      const [health, account, positions] = await Promise.all([
        adapter.health(),
        adapter.getAccountSummary(),
        adapter.getOpenPositions(),
      ]);
      res.json(selectSandboxExecutionCenterData({
        health,
        account,
        positions,
        latestOrder: sandboxBrokerRuntime.getLatestOrder(),
        killSwitchActive: executionRiskService.snapshot().globalKillSwitch,
        latestReconciliation: sandboxBrokerRuntime.reconciliationReports()[0] ?? null,
      }));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/health", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).health());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/account", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getAccountSummary());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/instruments", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getInstruments());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/pricing/:symbol", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getPricingSnapshot(req.params.symbol));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.post("/api/marketpilot/execution/sandbox/preview", async (req, res) => {
    const parsed = sandboxPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid sandbox order preview", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await sandboxBrokerRuntime.preview(parsed.data.provider, parsed.data.request));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.post("/api/marketpilot/execution/sandbox/confirmed-submit", async (req, res) => {
    const parsed = sandboxConfirmedSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid confirmed sandbox submission", issues: parsed.error.flatten() });
      return;
    }
    try {
      const order = await sandboxBrokerRuntime.submit(parsed.data);
      res.status(order.status === "rejected" ? 409 : 201).json(order);
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/orders/:orderId", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getOrderStatus(req.params.orderId));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/positions", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getOpenPositions());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox/:provider/trades", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.json(await sandboxBrokerRuntime.adapter(provider.data).getTrades());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.post("/api/marketpilot/execution/sandbox/:provider/sync", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.status(201).json(await accountSyncService.sync(
        sandboxBrokerRuntime.adapter(provider.data),
        typeof req.body?.userId === "string" ? req.body.userId : "execution-center-user",
      ));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.post("/api/marketpilot/execution/sandbox/:provider/disconnect", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.status(201).json(await sandboxBrokerRuntime.adapter(provider.data).disconnect());
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox-metrics", async (_req, res) => {
    res.json(sandboxExecutionMetrics.snapshot());
  });

  app.get("/api/marketpilot/execution/reliability-state/health", async (_req, res) => {
    res.json({
      ...reliabilityStateStore.health(),
      transactionCoordinator: sandboxBrokerRuntime.transactionalReliabilityHealth(),
      productionOrderSubmissionEnabled: false,
    });
  });

  app.get("/api/marketpilot/execution/provider-recovery", async (_req, res) => {
    res.json({
      providers: providerRecoveryTelemetry.list(),
      automaticOrderResubmissionEnabled: false,
      productionOrderSubmissionEnabled: false,
    });
  });

  app.get("/api/marketpilot/execution/resilience", async (_req, res) => {
    const providerRecovery = providerRecoveryTelemetry.list();
    const evidence = productionResilienceEvidenceService.snapshot();
    const resilience = productionResilienceService.evaluate({
      observabilityConfigured: evidence.observabilityConfigured || (eventLogService.persistenceHealth().configured && executionAuditLog.persistenceHealth().configured),
      incidentResponseRunbookAcknowledged: evidence.incidentResponseRunbookAcknowledged,
      incidentResponseDrillComplete: evidence.incidentResponseDrillComplete,
      disasterRecoveryBackupConfigured: evidence.disasterRecoveryBackupConfigured || Boolean(process.env.MARKETPILOT_DISASTER_RECOVERY_DIR),
      disasterRecoveryRestoreTestComplete: evidence.disasterRecoveryRestoreTestComplete,
      providerRecoveryTelemetryVisible: evidence.providerRecoveryTelemetryVisible || providerRecovery.length > 0,
      auditExportReplicationConfigured: evidence.auditExportReplicationConfigured || Boolean(auditExportService.health().exportDirectoryConfigured && auditExportService.health().archiveDirectoryConfigured),
      emergencyControlsAvailable: evidence.emergencyControlsAvailable || Boolean(emergencyControlService.snapshot()),
    });
    res.json({
      ...resilience,
      providerRecovery,
      evidence: evidence.records,
      productionOrderSubmissionEnabled: false,
    });
  });

  app.post("/api/marketpilot/execution/resilience/evidence", async (req, res) => {
    const parsed = productionResilienceEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid production resilience evidence", issues: parsed.error.flatten() });
      return;
    }
    res.status(201).json(productionResilienceEvidenceService.record(parsed.data));
  });

  app.post("/api/marketpilot/execution/sandbox/:provider/reconcile", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(400).json({ message: "Unsupported sandbox provider" });
      return;
    }
    try {
      res.status(201).json(await sandboxBrokerRuntime.reconcile(
        provider.data,
        typeof req.body?.userId === "string" ? req.body.userId : "execution-center-user",
      ));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.get("/api/marketpilot/execution/sandbox-reconciliation", async (_req, res) => {
    res.json(sandboxBrokerRuntime.reconciliationReports());
  });

  app.post("/api/marketpilot/execution/sandbox/idempotency/resolve", async (req, res) => {
    const parsed = sandboxIdempotencyResolutionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid idempotency resolution", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await sandboxBrokerRuntime.resolveIdempotency(parsed.data));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Idempotency resolution failed" });
    }
  });

  app.get("/api/marketpilot/execution/sandbox/idempotency", async (_req, res) => {
    res.json(sandboxBrokerRuntime.idempotencyRecords());
  });

  app.get("/api/marketpilot/execution/strategy-ops/dashboard", async (_req, res) => {
    res.json(selectStrategyPerformanceDashboard(
      liveDataPaperOpsRuntime.snapshot(),
      executionRiskService.snapshot(),
    ));
  });

  app.post("/api/marketpilot/execution/price-feeds/demo/poll", async (req, res) => {
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "";
    if (!symbol) {
      res.status(400).json({ message: "symbol is required" });
      return;
    }
    try {
      res.status(201).json(await liveDataPaperOpsRuntime.pollDemo(symbol));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Demo price poll failed" });
    }
  });

  app.post("/api/marketpilot/execution/price-feeds/:provider/poll", async (req, res) => {
    const provider = sandboxProviderSchema.safeParse(req.params.provider);
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "";
    if (!provider.success || !symbol) {
      res.status(400).json({ message: "A supported practice/demo provider and symbol are required" });
      return;
    }
    try {
      const adapter = sandboxBrokerRuntime.adapter(provider.data);
      const priceProvider = provider.data === "oanda_practice"
        ? new OandaPracticePriceFeedProvider(adapter)
        : new MetaTraderBridgePriceFeedProvider(adapter);
      res.status(201).json(await priceFeedService.poll(priceProvider, symbol));
    } catch (error) {
      sendSandboxError(res, error);
    }
  });

  app.post("/api/marketpilot/execution/strategy-ops", async (req, res) => {
    const parsed = operationalStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid operational strategy", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await liveDataPaperOpsRuntime.registerStrategy(parsed.data));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Strategy registration failed" });
    }
  });

  app.post("/api/marketpilot/execution/paper-runtime/:strategyId/start", async (req, res) => {
    try {
      res.status(201).json(await liveDataPaperOpsRuntime.startStrategy(req.params.strategyId));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Paper strategy start failed" });
    }
  });

  app.post("/api/marketpilot/execution/paper-runtime/:strategyId/stop", async (req, res) => {
    try {
      res.status(201).json(await liveDataPaperOpsRuntime.stopStrategy(req.params.strategyId));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Paper strategy stop failed" });
    }
  });

  const eventRiskSchema = z.object({
    id: z.string().optional(),
    type: z.enum(["CPI", "NFP", "FOMC", "central_bank_rate_decision", "crude_oil_inventories", "major_geopolitical_risk"]),
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    symbols: z.array(z.string()).default([]),
    assetClasses: z.array(z.enum(["forex", "commodity"])).default([]),
    notes: z.string().default(""),
    enabled: z.boolean().default(true),
  });

  app.post("/api/marketpilot/execution/event-blackouts", async (req, res) => {
    const parsed = eventRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid economic event", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(economicEventRiskService.configure(parsed.data));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Event configuration failed" });
    }
  });

  app.post("/api/marketpilot/execution/adaptation-suggestions/:id/review", async (req, res) => {
    const decision = z.enum(["approved", "rejected"]).safeParse(req.body?.decision);
    const reviewedBy = typeof req.body?.reviewedBy === "string" ? req.body.reviewedBy : "";
    if (!decision.success || !reviewedBy) {
      res.status(400).json({ message: "decision and reviewedBy are required" });
      return;
    }
    try {
      res.status(201).json(strategyAdaptationService.review(req.params.id, decision.data, reviewedBy));
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Suggestion review failed" });
    }
  });

  app.post("/api/marketpilot/execution/strategy-lifecycle/:strategyId/review", async (req, res) => {
    const decision = z.enum(["approved", "rejected"]).safeParse(req.body?.decision);
    const reviewedBy = typeof req.body?.reviewedBy === "string" ? req.body.reviewedBy : "";
    if (!decision.success || !reviewedBy) {
      res.status(400).json({ message: "decision and reviewedBy are required" });
      return;
    }
    try {
      res.status(201).json(strategyLifecycleMonitorService.review(req.params.strategyId, decision.data, reviewedBy));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Lifecycle review failed" });
    }
  });

  app.post("/api/marketpilot/execution/emergency", async (req, res) => {
    const actorId = typeof req.body?.actorId === "string" ? req.body.actorId : "unknown";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Emergency controls activated";
    res.status(201).json(await emergencyControlService.activate(actorId, reason));
  });

  app.get("/api/marketpilot/execution/status", async (_req, res) => {
    const [account, positions] = await Promise.all([
      paperExecutionProvider.getAccount(),
      paperExecutionProvider.getPositions(),
    ]);
    const circuit = executionRiskService.snapshot();
    const statusRequest = {
      strategyId: "status-check",
      instrument: "EUR/USD",
      side: "buy" as const,
      type: "market" as const,
      units: 1,
      price: 1,
      stopLoss: 0.99,
      mode: "paper" as const,
      explicitUserConfirmation: false,
      correlationId: "status-check",
    };
    const precheck = executionRiskPrecheckService.evaluate(statusRequest, {
      dataAgeSeconds: circuit.dataAgeSeconds,
      maxDataAgeSeconds: circuit.maxDataAgeSeconds,
      spread: 0.0001,
      maxSpread: 0.0005,
      volatilityPct: circuit.volatilityPct,
      maxVolatilityPct: circuit.maxVolatilityPct,
      dailyLoss: circuit.dailyLoss,
      maxDailyLoss: circuit.maxDailyLoss,
      openPositions: positions.length,
      maxOpenPositions: DEFAULT_AUTONOMY_POLICY.maxOpenPositions,
      symbolExposure: 0,
      requestedExposure: 1,
      maxSymbolExposure: account.equity,
      correlatedExposure: summarizePositions(positions).exposure,
      maxCorrelatedExposure: account.equity * 2,
      newsBlackoutActive: false,
      consecutiveLosses: circuit.consecutiveLosses,
      maxConsecutiveLosses: circuit.maxConsecutiveLosses,
      strategyEnabled: true,
      killSwitchActive: circuit.globalKillSwitch,
      accountConnected: account.connected,
      accountLastSyncAgeSeconds: 0,
      maxAccountSyncAgeSeconds: 60,
    });
    const brokerReadiness = brokerConnectionReadinessService.evaluate({
      provider: "paper",
      credentialsConfigured: true,
      credentialsEncrypted: true,
      providerReachable: true,
      accountMode: "paper",
      expectedEnvironment: "paper",
      marginAvailable: account.equity - account.marginUsed,
      minimumMarginRequired: 0,
      permissions: ["market_data", "paper_orders"],
      requiredPermissions: ["market_data", "paper_orders"],
      supportedInstruments: INSTRUMENTS.map((instrument) => instrument.symbol),
      requiredInstruments: [],
      rateLimitRemaining: 1_000,
      minimumRateLimitRemaining: 10,
      lastSyncAt: new Date().toISOString(),
      maxSyncAgeSeconds: 60,
      emergencyDisconnectAvailable: true,
    });
    const workflow = controlledLiveWorkflowService.snapshot("demo-user");
    const permission = workflow.permission ?? liveTradingPermissionService.blockedDefault("demo-user");
    const now = new Date();
    const providerRecovery = providerRecoveryTelemetry.list();
    const resilience = productionResilienceService.evaluate({
      observabilityConfigured: eventLogService.persistenceHealth().configured && executionAuditLog.persistenceHealth().configured,
      incidentResponseRunbookAcknowledged: process.env.MARKETPILOT_INCIDENT_RESPONSE_RUNBOOK_ACKNOWLEDGED === "true",
      incidentResponseDrillComplete: process.env.MARKETPILOT_INCIDENT_RESPONSE_DRILL_COMPLETE === "true",
      disasterRecoveryBackupConfigured: Boolean(process.env.MARKETPILOT_DISASTER_RECOVERY_DIR),
      disasterRecoveryRestoreTestComplete: process.env.MARKETPILOT_DISASTER_RECOVERY_RESTORE_TEST_COMPLETE === "true",
      providerRecoveryTelemetryVisible: providerRecovery.length > 0,
      auditExportReplicationConfigured: Boolean(auditExportService.health().exportDirectoryConfigured && auditExportService.health().archiveDirectoryConfigured),
      emergencyControlsAvailable: Boolean(emergencyControlService.snapshot()),
    }, now);
    const liveReadinessReport = liveReadinessReportService.generate({
      permission,
      strategyReady: paperAutomationService.listStrategyValidations().some((item) => item.verdict === "supervised_live_candidate"),
      brokerReady: brokerReadiness.readyForPaper,
      riskPrecheckApproved: precheck.approved,
      riskLimitsConfigured: DEFAULT_AUTONOMY_POLICY.maxDailyLoss > 0 && DEFAULT_AUTONOMY_POLICY.maxRiskPerTradePct > 0,
      marketRulesReady: [
        marketSessionRulesService.evaluate({
          assetClass: "forex",
          accountEquity: account.equity,
          currentMarginUsed: account.marginUsed,
          projectedMarginUsed: account.marginUsed,
          positionHeldOvernight: false,
          financingAcknowledged: true,
          now,
        }),
        marketSessionRulesService.evaluate({
          assetClass: "commodity",
          accountEquity: account.equity,
          currentMarginUsed: account.marginUsed,
          projectedMarginUsed: account.marginUsed,
          positionHeldOvernight: false,
          financingAcknowledged: true,
          now,
        }),
      ].every((rule) => rule.allowed),
      resilienceReady: resilience.ready,
      credentialsEncrypted: true,
      mfaVerified: false,
      complianceReady: false,
      auditTrailComplete: executionAuditLog.list().length > 0,
      orderPreviewReady: workflow.previewCount > 0,
      finalConfirmationReady: workflow.confirmationCount > 0,
      killSwitchArmed: !circuit.globalKillSwitch,
      sandboxSubmitAvailable: true,
      productionFeatureEnabled: false,
    });
    const projection = selectExecutionCenterData({
      automation: automationLevelService.snapshot(),
      killSwitchActive: circuit.globalKillSwitch,
      latestSignals: paperAutomationService.getJournal(),
      positions,
      strategyValidations: paperAutomationService.listStrategyValidations(),
      riskPrecheck: precheck,
      auditLog: executionAuditLog.list(),
      brokerReadiness,
      liveReadinessReport,
      activeRiskLimits: {
        maxDailyLoss: DEFAULT_AUTONOMY_POLICY.maxDailyLoss,
        maxRiskPerTradePct: DEFAULT_AUTONOMY_POLICY.maxRiskPerTradePct,
      },
    });
    res.json({
      ...projection,
      account,
      positionSummary: summarizePositions(positions),
      controlledLiveWorkflow: workflow,
      emergencyControls: emergencyControlService.snapshot(),
      liveReadiness: evaluateLiveReadiness({
        brokerConnected: false,
        accountSynced: false,
        credentialsEncrypted: false,
        mfaAcknowledged: false,
        proficiencyGatesPassed: false,
        liveRiskLimitsConfigured: false,
        dailyLossLimitConfigured: false,
        maxTradeSizeConfigured: false,
        killSwitchEnabled: true,
        complianceDisclosureAcknowledged: false,
      }),
    });
  });

  app.post("/api/marketpilot/execution/kill-switch", async (_req, res) => {
    res.status(201).json(executionRiskService.triggerGlobalKillSwitch());
  });

  app.get("/api/marketpilot/execution/audit-log", async (_req, res) => {
    res.json(executionAuditLog.list());
  });

  app.post("/api/marketpilot/options/simulate", async (req, res) => {
    const parsed = optionsSimulationRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid options simulation request",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const overview = await storage.getMarketPilotOverview();
    res.json(optionsSimulationService.simulate(parsed.data, overview.proficiencyScores));
  });

  app.get("/api/marketpilot/trade-tickets", async (_req, res) => {
    res.json(await storage.getTradeTickets());
  });

  app.post("/api/marketpilot/trade-tickets", async (req, res) => {
    const parsed = tradeTicketProposalSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid trade ticket proposal",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const ticket = await storage.createTradeTicket(parsed.data);
    const overview = await storage.getMarketPilotOverview();
    eventLogService.append({
      type: "trade.ticket_created",
      userId: overview.user.id,
      sourceService: "execution-service",
      payload: { ticketId: ticket.id, asset: ticket.asset, status: ticket.status },
    });
    res.status(201).json(ticket);
  });

  app.post("/api/marketpilot/trade-tickets/:id/order-preview", async (req, res, next) => {
    try {
      demoOnlyPolicyService.assertAllowed({
        provider: "paper_provider",
        accountMode: "paper",
        verificationSource: "tradeTicket.paper_preview",
        attemptedAction: "paper.order_preview",
        actor: "demo-user",
        source: "routes",
        metadata: { ticketId: req.params.id },
      });
      res.status(201).json(await storage.createOrderPreview(req.params.id));
    } catch (error) {
      if (error instanceof DemoOnlyPolicyError) {
        res.status(403).json(error.result);
        return;
      }
      if (error instanceof Error && "status" in error && typeof error.status === "number") {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  app.post("/api/marketpilot/trade-tickets/:id/paper-fill", async (req, res, next) => {
    const parsed = paperTradeFillRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Paper fill requires explicit compliance acknowledgement",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      demoOnlyPolicyService.assertAllowed({
        provider: "paper_provider",
        accountMode: "paper",
        verificationSource: "tradeTicket.paper_fill",
        attemptedAction: "paper.fill",
        actor: "demo-user",
        source: "routes",
        metadata: { ticketId: req.params.id },
      });
      res.status(201).json(await storage.fillPaperTrade(req.params.id, parsed.data));
    } catch (error) {
      if (error instanceof DemoOnlyPolicyError) {
        res.status(403).json(error.result);
        return;
      }
      if (error instanceof Error && "status" in error && typeof error.status === "number") {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  app.post("/api/marketpilot/trade-tickets/:id/paper-close", async (req, res, next) => {
    const parsed = paperTradeCloseRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid paper close request",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      demoOnlyPolicyService.assertAllowed({
        provider: "paper_provider",
        accountMode: "paper",
        verificationSource: "tradeTicket.paper_close",
        attemptedAction: "paper.close",
        actor: "demo-user",
        source: "routes",
        metadata: { ticketId: req.params.id },
      });
      res.status(201).json(await storage.closePaperTrade(req.params.id, parsed.data));
    } catch (error) {
      if (error instanceof DemoOnlyPolicyError) {
        res.status(403).json(error.result);
        return;
      }
      if (error instanceof Error && "status" in error && typeof error.status === "number") {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  app.get("/api/marketpilot/journal", async (_req, res) => {
    res.json(await storage.getJournalEntries());
  });

  app.post("/api/marketpilot/journal/reviews", async (req, res, next) => {
    const parsed = journalReviewSubmissionSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid journal review submission",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      res.status(201).json(await storage.submitJournalReview(parsed.data));
    } catch (error) {
      if (error instanceof Error && "status" in error && typeof error.status === "number") {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  return httpServer;
}

async function loadMetricsSnapshot() {
  const overview = await storage.getMarketPilotOverview();
  const verificationQuality = verificationQualityService.evaluate(overview);
  return metricsService.snapshot({ overview, verificationQuality });
}

function sendSandboxError(res: Response, error: unknown) {
  if (error instanceof SandboxBrokerError) {
    res.status(error.status).json(error.toResponse());
    return;
  }
  res.status(500).json({
    code: "order_rejected",
    message: error instanceof Error ? error.message : "Sandbox broker operation failed",
    productionOrderSubmissionEnabled: false,
  });
}
