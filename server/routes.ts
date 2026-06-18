import type { Express } from "express";
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
import { metricsService } from "./metricsService";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
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
import { automationLevelSchema, automationLevelService } from "./execution/automationLevels";
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
    const overview = await storage.getMarketPilotOverview();
    const verificationQuality = verificationQualityService.evaluate(overview);
    res.json(metricsService.snapshot({ overview, verificationQuality }));
  });

  app.get("/api/marketpilot/event-log", async (_req, res) => {
    res.json(eventLogService.snapshot());
  });

  app.get("/api/marketpilot/memory/health", async (_req, res) => {
    const overview = await storage.getMarketPilotOverview();
    agentMemoryService.hydrateFromOverview(overview);
    res.json(agentMemoryService.health());
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

  app.get("/api/marketpilot/vector-store/health", async (_req, res) => {
    res.json(vectorStore.health());
  });

  app.get("/api/marketpilot/cache/health", async (_req, res) => {
    res.json(cacheStore.health());
  });

  app.get("/api/marketpilot/timeseries/health", async (_req, res) => {
    res.json(timeSeriesStore.health());
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
    res.status(201).json(await aiResearchDraftService.generate(await storage.getMarketPilotOverview(), symbol));
  });

  app.get("/api/marketpilot/knowledge-graph", async (req, res) => {
    const start = typeof req.query.start === "string" ? req.query.start : null;
    res.json(knowledgeGraphService.build(await storage.getMarketPilotOverview(), start));
  });

  app.get("/api/marketpilot/analytics/institutional", async (_req, res) => {
    res.json(institutionalAnalyticsService.snapshot(await storage.getMarketPilotOverview()));
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
    ]);

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
    res.json(alertService.evaluateAlerts({
      overview,
      events: eventCalendarService.getUpcomingEvents(),
    }));
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

    res.json(backtestingService.run(parsed.data));
  });

  app.post("/api/marketpilot/backtests/markets", async (req, res) => {
    const parsed = marketBacktestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid forex/commodity backtest", issues: parsed.error.flatten() });
      return;
    }
    res.json(marketBacktestingService.run(parsed.data));
  });

  app.post("/api/webhooks/tradingview", tradingViewRateLimiter, async (req, res) => {
    const result = tradingViewWebhookProvider.receive(req.body);
    res.status(result.accepted ? 202 : 400).json(result);
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

  app.get("/api/marketpilot/execution/automation-level", async (_req, res) => {
    res.json(automationLevelService.snapshot());
  });

  app.post("/api/marketpilot/execution/automation-level", async (req, res) => {
    const parsed = automationLevelSchema.safeParse(req.body?.level);
    if (!parsed.success) {
      res.status(400).json({ message: "Automation level must be an integer from 0 through 5" });
      return;
    }
    res.status(201).json(automationLevelService.setLevel(parsed.data));
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
      res.status(400).json({ message: "Invalid live permission evidence", issues: parsed.error.flatten() });
      return;
    }
    const permission = controlledLiveWorkflowService.evaluatePermission(parsed.data);
    res.status(permission.allowed ? 201 : 409).json(permission);
  });

  app.post("/api/marketpilot/execution/live-order-preview", async (req, res) => {
    const parsed = controlledPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid controlled-live order preview", issues: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(controlledLiveWorkflowService.createPreview(parsed.data));
    } catch (error) {
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
      const confirmation = controlledLiveWorkflowService.confirm(parsed.data);
      res.status(confirmation.accepted ? 201 : 409).json(confirmation);
    } catch (error) {
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
    const liveReadinessReport = liveReadinessReportService.generate({
      permission,
      strategyReady: paperAutomationService.listStrategyValidations().some((item) => item.verdict === "supervised_live_candidate"),
      brokerReady: brokerReadiness.readyForPaper,
      riskPrecheckApproved: precheck.approved,
      riskLimitsConfigured: DEFAULT_AUTONOMY_POLICY.maxDailyLoss > 0 && DEFAULT_AUTONOMY_POLICY.maxRiskPerTradePct > 0,
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
      res.status(201).json(await storage.createOrderPreview(req.params.id));
    } catch (error) {
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
      res.status(201).json(await storage.fillPaperTrade(req.params.id, parsed.data));
    } catch (error) {
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
      res.status(201).json(await storage.closePaperTrade(req.params.id, parsed.data));
    } catch (error) {
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
