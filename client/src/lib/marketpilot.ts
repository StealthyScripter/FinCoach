import type { AgentOutput, Alert, BacktestRequest, BacktestResult, BrokerReadiness, ComplianceAuditSummary, ComplianceProfile, DecisionCard, EvaluationReport, EventLogSnapshot, IngestionSnapshot, InstitutionalAnalyticsSnapshot, KnowledgeGraphReport, LiveAssistancePolicy, MarketMoveInvestigation, MarketMovementExplanation, MarketPilotEvent, MarketPilotOverview, MemoryHealth, MetricsSnapshot, OrderPreview, PortfolioRiskAnalytics, PredictionRecord, PredictionReview, PrioritizedSignal, ProviderRegistrySnapshot, RiskSettings, SecurityPostureReport, StorageHealth, StrategySuggestion, SupervisorReport, TradingAssistantResponse, VerificationQualityReport } from "@shared/schema";
import type { DemoRunExportPayload, DemoRunFinalReport, DemoRunStatus, DemoRunTelemetry } from "@shared/demoRun";
import { apiRequest } from "@/lib/queryClient";

export type { BacktestRequest, BacktestResult, BrokerReadiness, ComplianceAuditSummary, ComplianceProfile, DecisionCard, EvaluationReport, EventLogSnapshot, IngestionSnapshot, InstitutionalAnalyticsSnapshot, KnowledgeGraphReport, LiveAssistancePolicy, MarketMoveInvestigation, MarketMovementExplanation, MemoryHealth, MetricsSnapshot, OrderPreview, PortfolioRiskAnalytics, PredictionRecord, PredictionReview, PrioritizedSignal, ProviderRegistrySnapshot, RiskSettings, SecurityPostureReport, StorageHealth, StrategySuggestion, SupervisorReport, TradingAssistantResponse, VerificationQualityReport };
export type KnowledgeGraphArchiveSnapshot = {
  events: MarketPilotEvent[];
};

export type TelegramSystemStatus = {
  configured: boolean;
  botTokenConfigured: boolean;
  allowedUserIdConfigured: boolean;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookUrlConfigured: boolean;
  allowedUserId: string | null;
  lastCommand: string | null;
  lastCommandAt: string | null;
  pendingConfirmations: number;
  rateLimit: {
    limited: boolean;
    remaining: number;
    resetAt: string | null;
  };
  productionLiveExecutionBlocked: true;
};

export type ToolConnectorRegistrySnapshot = {
  generatedAt: string;
  connectors: Array<{
    id: string;
    name: string;
    type: "broker" | "trading_platform" | "analysis_platform" | "payment_or_cash_app" | "data_provider" | "notification_provider";
    providerName: string;
    connectorType: "broker" | "trading_platform" | "analysis_platform" | "payment_or_cash_app" | "data_provider" | "notification_provider";
    environmentLabel: string;
    supportedAssetClasses: string[];
    supportedCapabilities: string[];
    supportedActions: string[];
    disabledActions: string[];
    safetyConstraints: string[];
    costLevel: "internal" | "free" | "demo" | "low" | "paid";
    authMethod: string;
    environment: "disabled" | "demo" | "practice" | "paper" | "bridge" | "internal";
    health: "healthy" | "degraded" | "disabled";
    limitations: string[];
    liveExecutionSupport: boolean;
    sandboxSupport: boolean;
    enabled: boolean;
    configured: boolean;
    requiredEnvVars: string[];
    missingEnvVars: string[];
    lastCheckedAt: string;
    lastSyncAt: string | null;
    recentSignals?: number;
    signalQuality?: { accepted: number; reviewRequired: number; rejected: number };
  }>;
};

export type { DemoRunExportPayload, DemoRunFinalReport, DemoRunStatus, DemoRunTelemetry };

export type AnalyticsArchiveSnapshot = {
  events: MarketPilotEvent[];
};

export type RAGArchiveSnapshot = {
  generatedAt: string;
  runs: Array<{
    id: string;
    userId: string;
    query: string;
    chunkCount: number;
    confidence: number;
    sourceFreshness: "fresh" | "stale" | "mixed";
    citationIds: string[];
    chunkIds: string[];
    createdAt: string;
  }>;
  documents: Array<{
    id: string;
    userId: string;
    runId: string;
    kind: string;
    text: string;
    metadata: Record<string, unknown>;
    timestamp: string;
    chunkIds: string[];
    createdAt: string;
  }>;
};

export type VectorArchiveSnapshot = {
  generatedAt: string;
  records: Array<{
    id: string;
    vector: number[];
    text: string;
    metadata: Record<string, unknown>;
  }>;
};

export type TimeSeriesArchiveSnapshot = {
  generatedAt: string;
  priceBars: Array<{
    symbol: string;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  economicObservations: Array<{
    seriesId: string;
    timestamp: string;
    value: number;
    source: string;
  }>;
  optionsSnapshots: Array<{
    underlying: string;
    timestamp: string;
    impliedVolatilityPct: number;
    openInterest: number;
  }>;
  ingestionRuns: Array<{
    id: string;
    providerId: string;
    status: "success" | "partial" | "failed" | "dry_run";
    startedAt: string;
    completedAt: string;
    records: number;
    freshness: { newestTimestamp: string | null; oldestTimestamp: string | null };
    errors: string[];
  }>;
};

export type IngestionArchiveSnapshot = {
  generatedAt: string;
  runs: Array<{
    id: string;
    userId: string;
    providerId: string;
    status: "success" | "partial" | "failed" | "dry_run";
    startedAt: string;
    completedAt: string;
    records: number;
    freshness: { newestTimestamp: string | null; oldestTimestamp: string | null };
    errors: string[];
  }>;
};

export type RetrievedContext = {
  query: string;
  chunks: Array<{
    id: string;
    kind: string;
    text: string;
    metadata: Record<string, unknown>;
    timestamp: string;
    chunkId: string;
    score: number;
  }>;
  citations: Array<{
    id: string;
    label: string;
    timestamp: string;
    source: string;
  }>;
  similarMemory: Array<{
    id: string;
    kind: string;
    text: string;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
    source: "semantic" | "long_term";
    relevance: number;
    artifactLinks: Array<{
      label: string;
      href: string;
    }>;
  }>;
  confidence: number;
  sourceFreshness: "fresh" | "stale" | "mixed";
  contradictionHints: string[];
};

export type PredictionInsightReport = {
  generatedAt: string;
  reviewCount: number;
  topThemes: Array<{
    theme: string;
    count: number;
    latestPredictionId: string;
    latestReviewId: string;
    latestUpdatedLesson: string;
    latestFutureRuleAdjustment: string;
    exampleMissingEvidence: string[];
  }>;
  recentRules: Array<{
    predictionId: string;
    reviewedAt: string;
    whatWasMissed: string;
    updatedLesson: string;
    futureRuleAdjustment: string;
  }>;
};

export type TraceReport = {
  correlationId: string;
  generatedAt: string;
  entryCount: number;
  eventCount: number;
  auditCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  entries: Array<
    | {
        source: "event_log";
        id: string;
        correlationId: string;
        timestamp: string;
        summary: string;
        sourceService: string;
        detail: Record<string, unknown>;
      }
    | {
        source: "execution_audit";
        id: string;
        correlationId: string;
        timestamp: string;
        summary: string;
        action: string;
        outcome: string;
        detail: Record<string, unknown>;
      }
  >;
};

export type OtelTraceExport = {
  correlationId: string;
  generatedAt: string;
  traceId: string;
  spanCount: number;
  spans: Array<{
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    attributes: Record<string, string | number | boolean | null>;
    status: "ok" | "error";
  }>;
};

export type ModelValidationBenchmarkReport = {
  generatedAt: string;
  benchmarkVersion: string;
  datasetName: string;
  overallScore: number;
  status: "pass" | "review" | "fail";
  bestModelId: string;
  worstModelId: string;
  models: Array<{
    id: string;
    name: string;
    allocation: Array<{ symbol: string; targetPct: number }>;
    backtest: BacktestResult;
    score: number;
    verdict: "pass" | "watchlist" | "reject";
    notes: string[];
  }>;
  requiredActions: string[];
  evidence: string[];
};

export type StrategyValidationScorecard = {
  strategyId: string;
  instrument: string;
  backtestScore: number;
  walkForwardScore: number;
  monteCarloRobustnessScore: number;
  drawdownScore: number;
  riskOfRuinScore: number;
  tradeCountSufficiency: number;
  overfittingWarning: boolean;
  regimeSensitivity: "low" | "moderate" | "high";
  symbolSuitability: number;
  overallScore: number;
  verdict: "reject" | "paper_only" | "watchlist" | "supervised_live_candidate";
  reasons: string[];
  evaluatedAt: string;
  liveExecutionAuthorized: false;
};

export type StrategyValidationInput = {
  strategyId: string;
  instrument: string;
  backtest: {
    netReturnPct: number;
    sharpe: number;
    profitFactor: number;
    maxDrawdownPct: number;
    tradeCount: number;
  };
  walkForward: {
    profitableWindowsPct: number;
    outOfSampleReturnPct: number;
    degradationPct: number;
  };
  monteCarlo: {
    profitableRunsPct: number;
    medianEndingReturnPct: number;
    riskOfRuinPct: number;
  };
  regimePerformance: Record<string, number>;
  symbolPerformance: Record<string, number>;
};
import { useMutation, useQuery } from "@tanstack/react-query";

export type ScenarioName = "2008_crisis" | "2020_covid_crash" | "2022_rate_shock" | "oil_shock";

export type ScenarioSimulation = {
  scenario: ScenarioName;
  portfolioValueBefore: number;
  estimatedPortfolioValueAfter: number;
  estimatedDrawdownPct: number;
  estimatedRecoveryMonths: number;
  largestRiskContributor: string;
  liquidityWarning: string | null;
  riskBreaches: string[];
  notes: string[];
};

export type PortfolioModelRecommendation = {
  id:
    | "three_fund"
    | "sixty_forty"
    | "eighty_twenty"
    | "core_satellite"
    | "dividend_income"
    | "factor_portfolio"
    | "risk_parity"
    | "tactical_allocation";
  name: string;
  level: "beginner" | "intermediate";
  objective: string;
  targetAllocation: Array<{
    sleeve: string;
    symbol: string;
    targetPct: number;
    currentPct: number;
    driftPct: number;
    estimatedTradeValue: number;
  }>;
  maxDriftPct: number;
  turnoverEstimate: number;
  riskNotes: string[];
  suitabilityGates: string[];
};

export type MarketEvent = {
  id: string;
  title: string;
  category: "macro" | "earnings" | "central_bank" | "liquidity";
  impact: "low" | "medium" | "high";
  startsAt: string;
  relatedAssets: string[];
  riskNote: string;
};

export type OptionLeg = {
  action: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  premium: number;
  contracts: number;
};

export type OptionsSimulationRequest = {
  underlying: string;
  underlyingPrice: number;
  daysToExpiration: number;
  impliedVolatilityPct: number;
  legs: OptionLeg[];
};

export type OptionsSimulation = {
  underlying: string;
  strategyName: string;
  underlyingPrice: number;
  daysToExpiration: number;
  impliedVolatilityPct: number;
  netDebit: number;
  maxLoss: number | null;
  maxProfit: number | null;
  breakevens: number[];
  priceRange: Array<{ price: number; payoff: number }>;
  riskRewardSummary: string;
  assignmentRisk: string;
  proficiencyGate: {
    requiredScore: number;
    currentScore: number;
    unlocked: boolean;
    requiredActions: string[];
  };
  safetyNotes: string[];
};

export type StrategyLabSnapshot = {
  generatedAt: string;
  topStrategies: Array<{ strategyId: string; strategyName: string; overallScore: number; confidence: number; verdict: string; sampleSize: number }>;
  weakStrategies: Array<{ strategyId: string; strategyName: string; overallScore: number; confidence: number; verdict: string; sampleSize: number }>;
  retirementCandidates: Array<{ strategyId: string; strategyName: string; overallScore: number; confidence: number; verdict: string; sampleSize: number }>;
  adaptationSuggestions: Array<{ strategyId: string; type: string; reason: string; status: string }>;
  latestLessons: Array<{ source: string; lesson: string; strategyId: string | null; timestamp: string }>;
  memoryGraph: any;
  recurringMistakes: any;
  confidenceCalibration: any;
  strategyEvolution: Array<any>;
  regretAnalysis: any;
  counterfactualAnalysis: any;
  performanceDecay: any;
  crossStrategyComparison: any;
  learningPriorities: any;
  evidenceDepth: Array<{
    strategyId: string;
    verdict: "insufficient" | "developing" | "acceptable" | "robust";
    score: number;
    totalTrades: number;
    recentTrades: number;
    symbolsTested: string[];
    regimesTested: string[];
    timeframesTested: string[];
    winLossDiversity: boolean;
    stressScenarioCoverage: number;
    minimumEvidenceThreshold: boolean;
  }>;
  closedTradeHistory: Array<{
    strategyId: string;
    strategyName: string;
    trades: Array<{
      id: string;
      symbol: string;
      tradeKind: "paper_trade" | "sandbox_trade";
      verdict: string | null;
      outcome: string;
      realizedPnL?: number;
      exitReason?: string;
      openedAt: string;
      closedAt: string;
      regime: string | null;
      timeframe: string | null;
      originalStrategyInputs?: Record<string, unknown> | null;
      signalFeatures?: Record<string, unknown> | null;
    }>;
  }>;
  rejectedSignalLearning: Array<{
    strategyId: string;
    strategyName: string;
    signals: Array<{
      id: string;
      strategyId: string;
      symbol: string;
      rejectedAt: string;
      rejectionReason: string;
      laterOutcome: string;
      correct: boolean;
      missedOpportunity: boolean;
      avoidedLoss: boolean;
      ruleImprovementSuggestion: string;
    }>;
  }>;
  verdictExplanations: Array<{
    strategyId: string;
    strategyName: string;
    verdict: string;
    overallScore: number;
    sampleDepthSufficient: boolean;
    whyRankedThisWay: string[];
    strongestEvidence: string[];
    weakestEvidence: string[];
    missingEvidence: string[];
    confidenceImprovement: string[];
  }>;
};

export function useMarketPilotOverview() {
  return useQuery<MarketPilotOverview>({
    queryKey: ["/api/marketpilot/overview"],
  });
}

export function useMarketExplanation(symbol: string) {
  return useQuery<MarketMovementExplanation>({
    queryKey: [`/api/marketpilot/explain/${symbol}`],
  });
}

export function useAssistantOpportunities() {
  return useQuery<{
    primary: PrioritizedSignal[];
    secondary: PrioritizedSignal[];
    advanced: PrioritizedSignal[];
    all: PrioritizedSignal[];
  }>({
    queryKey: ["/api/marketpilot/assistant/opportunities"],
  });
}

export function useMarketMoveInvestigation(symbol: string) {
  return useQuery<MarketMoveInvestigation>({
    queryKey: [`/api/marketpilot/assistant/investigate/${symbol}`],
  });
}

export function usePredictionReviews() {
  return useQuery<PredictionReview[]>({
    queryKey: ["/api/marketpilot/assistant/prediction-reviews"],
  });
}

export function usePredictionInsights() {
  return useQuery<PredictionInsightReport>({
    queryKey: ["/api/marketpilot/assistant/prediction-insights"],
  });
}

export function usePredictionRecords() {
  return useQuery<PredictionRecord[]>({
    queryKey: ["/api/marketpilot/assistant/predictions"],
  });
}

export function useScenarioSimulation(scenario: ScenarioName) {
  return useQuery<ScenarioSimulation>({
    queryKey: [`/api/marketpilot/simulations/${scenario}`],
  });
}

export function usePortfolioModels() {
  return useQuery<PortfolioModelRecommendation[]>({
    queryKey: ["/api/marketpilot/portfolio/models"],
  });
}

export function usePortfolioRiskAnalytics() {
  return useQuery<PortfolioRiskAnalytics>({
    queryKey: ["/api/marketpilot/portfolio/risk-analytics"],
  });
}

export function useMarketEvents() {
  return useQuery<MarketEvent[]>({
    queryKey: ["/api/marketpilot/events"],
  });
}

export function useAgentOutputs() {
  return useQuery<AgentOutput[]>({
    queryKey: ["/api/marketpilot/agents"],
  });
}

export function useAgentSupervisor() {
  return useQuery<SupervisorReport>({
    queryKey: ["/api/marketpilot/agents/supervisor"],
  });
}

export function useEvaluationReport() {
  return useQuery<EvaluationReport>({
    queryKey: ["/api/marketpilot/evaluations/current"],
  });
}

export function useVerificationQuality() {
  return useQuery<VerificationQualityReport>({
    queryKey: ["/api/marketpilot/verification/quality"],
  });
}

export function useAlerts() {
  return useQuery<Alert[]>({
    queryKey: ["/api/marketpilot/alerts"],
  });
}

export function useIngestionSnapshot() {
  return useQuery<IngestionSnapshot>({
    queryKey: ["/api/marketpilot/ingestion/snapshot"],
  });
}

export function useBrokerReadiness() {
  return useQuery<BrokerReadiness[]>({
    queryKey: ["/api/marketpilot/broker/readiness"],
  });
}

export function useLiveAssistancePolicy() {
  return useQuery<LiveAssistancePolicy>({
    queryKey: ["/api/marketpilot/live/policy"],
  });
}

export function useSecurityPosture() {
  return useQuery<SecurityPostureReport>({
    queryKey: ["/api/marketpilot/security/posture"],
  });
}

export function useStorageHealth() {
  return useQuery<StorageHealth>({
    queryKey: ["/api/health/storage"],
  });
}

export function useProviderHealth() {
  return useQuery<ProviderRegistrySnapshot>({
    queryKey: ["/api/health/providers"],
  });
}

export function useTelegramStatus() {
  return useQuery<TelegramSystemStatus>({
    queryKey: ["/api/marketpilot/telegram/status"],
  });
}

export function useDemoRunStatus() {
  return useQuery<DemoRunStatus>({
    queryKey: ["/api/marketpilot/demo-run/status"],
  });
}

export function useDemoRunTelemetry() {
  return useQuery<DemoRunTelemetry>({
    queryKey: ["/api/marketpilot/demo-run/telemetry"],
  });
}

export function useDemoRunReport() {
  return useQuery<DemoRunFinalReport>({
    queryKey: ["/api/marketpilot/demo-run/report"],
  });
}

export function useDemoRunExport() {
  return useQuery<DemoRunExportPayload>({
    queryKey: ["/api/marketpilot/demo-run/export"],
  });
}

export function useConnectorRegistry() {
  return useQuery<ToolConnectorRegistrySnapshot>({
    queryKey: ["/api/marketpilot/connectors"],
  });
}

export function useMetricsSnapshot() {
  return useQuery<MetricsSnapshot>({
    queryKey: ["/api/metrics"],
  });
}

export function useEventLogSnapshot() {
  return useQuery<EventLogSnapshot>({
    queryKey: ["/api/marketpilot/event-log"],
  });
}

export function useMemoryHealth() {
  return useQuery<MemoryHealth>({
    queryKey: ["/api/marketpilot/memory/health"],
  });
}

export function useKnowledgeGraph(startNodeId?: string | null) {
  const start = startNodeId?.trim() ?? "";
  return useQuery<KnowledgeGraphReport>({
    queryKey: ["/api/marketpilot/knowledge-graph", start],
    queryFn: async () => {
      const endpoint = start.length > 0
        ? `/api/marketpilot/knowledge-graph?start=${encodeURIComponent(start)}`
        : "/api/marketpilot/knowledge-graph";
      const response = await apiRequest("GET", endpoint);
      return response.json();
    },
  });
}

export function useKnowledgeGraphArchive() {
  return useQuery<KnowledgeGraphArchiveSnapshot>({
    queryKey: ["/api/marketpilot/knowledge-graph/archive"],
  });
}

export function useAnalyticsArchive() {
  return useQuery<AnalyticsArchiveSnapshot>({
    queryKey: ["/api/marketpilot/analytics/archive"],
  });
}

export function useModelValidationBenchmark() {
  return useQuery<ModelValidationBenchmarkReport>({
    queryKey: ["/api/marketpilot/analytics/model-validation"],
  });
}

export function useStrategyValidationMutation() {
  return useMutation<StrategyValidationScorecard, Error, StrategyValidationInput>({
    mutationFn: async (input) => {
      const response = await apiRequest("POST", "/api/marketpilot/strategy-validation", input);
      return response.json();
    },
  });
}

export function useStrategyLab() {
  return useQuery<StrategyLabSnapshot>({
    queryKey: ["/api/marketpilot/strategy-lab"],
  });
}

export function useOtelTraceExport(correlationId: string) {
  return useQuery<OtelTraceExport>({
    queryKey: [`/api/marketpilot/traces/${correlationId}/otel`],
    enabled: correlationId.trim().length > 0,
  });
}


export function useInstitutionalAnalytics() {
  return useQuery<InstitutionalAnalyticsSnapshot>({
    queryKey: ["/api/marketpilot/analytics/institutional"],
  });
}

export function useAIStatus() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/ai/status"] });
}

export function useRAGContext(query?: string | null) {
  const trimmed = (query === undefined ? "market risk verification" : query ?? "").trim();
  const enabled = query !== null;
  return useQuery<RetrievedContext>({
    queryKey: ["/api/marketpilot/rag/context", trimmed, enabled],
    queryFn: async () => {
      const endpoint = trimmed.length > 0
        ? `/api/marketpilot/rag/context?query=${encodeURIComponent(trimmed)}`
        : "/api/marketpilot/rag/context";
      const response = await apiRequest("GET", endpoint);
      return response.json();
    },
    enabled,
  });
}

export function useRAGArchive() {
  return useQuery<RAGArchiveSnapshot>({
    queryKey: ["/api/marketpilot/rag/archive"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/marketpilot/rag/archive");
      return response.json();
    },
  });
}

export function useVectorStoreHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/vector-store/health"] });
}

export function useVectorStoreArchive() {
  return useQuery<VectorArchiveSnapshot>({
    queryKey: ["/api/marketpilot/vector-store/archive"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/marketpilot/vector-store/archive");
      return response.json();
    },
  });
}

export function useCacheHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/cache/health"] });
}

export function useTimeSeriesHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/timeseries/health"] });
}

export function useTimeSeriesArchive() {
  return useQuery<TimeSeriesArchiveSnapshot>({
    queryKey: ["/api/marketpilot/timeseries/archive"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/marketpilot/timeseries/archive");
      return response.json();
    },
  });
}

export function useIngestionArchive() {
  return useQuery<IngestionArchiveSnapshot>({
    queryKey: ["/api/marketpilot/ingestion/archive"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/marketpilot/ingestion/archive");
      return response.json();
    },
  });
}

export function useAIResearchEvaluation() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/ai/evaluation"] });
}

export function useComplianceAudit(target?: string) {
  const query = target ? `?target=${encodeURIComponent(target)}` : "";
  return useQuery<ComplianceAuditSummary>({
    queryKey: [`/api/marketpilot/audit/compliance${query}`],
  });
}

export function useComplianceProfile() {
  return useQuery<ComplianceProfile>({
    queryKey: ["/api/marketpilot/compliance/profile"],
  });
}

export function useRiskSettings() {
  return useQuery<RiskSettings>({
    queryKey: ["/api/marketpilot/risk/settings"],
  });
}

export function formatStage(stage: MarketPilotOverview["progression"]["currentStage"]) {
  switch (stage) {
    case "foundation":
      return "Foundation Mode";
    case "research_paper":
      return "Research and Paper Portfolio Mode";
    case "supervised_live":
      return "Supervised Live Assistance Mode";
  }
}

export function scoreTone(score: number) {
  if (score >= 75) return "text-emerald-400";
  if (score >= 60) return "text-sky-400";
  if (score >= 45) return "text-amber-300";
  return "text-rose-400";
}
