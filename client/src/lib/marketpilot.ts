import type { AgentOutput, Alert, BacktestRequest, BacktestResult, BrokerReadiness, ComplianceAuditSummary, ComplianceProfile, DecisionCard, EvaluationReport, EventLogSnapshot, IngestionSnapshot, InstitutionalAnalyticsSnapshot, KnowledgeGraphReport, LiveAssistancePolicy, MarketMoveInvestigation, MarketMovementExplanation, MarketPilotOverview, MemoryHealth, MetricsSnapshot, OrderPreview, PortfolioRiskAnalytics, PredictionRecord, PredictionReview, PrioritizedSignal, ProviderRegistrySnapshot, RiskSettings, SecurityPostureReport, StorageHealth, StrategySuggestion, SupervisorReport, TradingAssistantResponse, VerificationQualityReport } from "@shared/schema";

export type { BacktestRequest, BacktestResult, BrokerReadiness, ComplianceAuditSummary, ComplianceProfile, DecisionCard, EvaluationReport, EventLogSnapshot, IngestionSnapshot, InstitutionalAnalyticsSnapshot, KnowledgeGraphReport, LiveAssistancePolicy, MarketMoveInvestigation, MarketMovementExplanation, MemoryHealth, MetricsSnapshot, OrderPreview, PortfolioRiskAnalytics, PredictionRecord, PredictionReview, PrioritizedSignal, ProviderRegistrySnapshot, RiskSettings, SecurityPostureReport, StorageHealth, StrategySuggestion, SupervisorReport, TradingAssistantResponse, VerificationQualityReport };
import { useQuery } from "@tanstack/react-query";

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

export function useKnowledgeGraph() {
  return useQuery<KnowledgeGraphReport>({
    queryKey: ["/api/marketpilot/knowledge-graph"],
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

export function useRAGContext() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/rag/context"] });
}

export function useVectorStoreHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/vector-store/health"] });
}

export function useCacheHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/cache/health"] });
}

export function useTimeSeriesHealth() {
  return useQuery<any>({ queryKey: ["/api/marketpilot/timeseries/health"] });
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
