export type ResearchStrategyStatus = "research" | "watch" | "candidate" | "focused_research" | "demote" | "pause_research" | "retire_research" | "require_more_evidence";
export type RankingMetrics = { oosExpectancy: number; confidenceInterval: number; sampleDepth: number; walkForwardStability: number; parameterRobustness: number; costResilience: number; maxDrawdown: number; tailRisk: number; regimeDiversity: number; operationalComplexity: number; turnover: number; exposure: number };
export type RankingCandidateInput = {
  strategyId: string; strategyVersion: number; hypothesisId: string; courtCaseId: string; courtVerdict: "reject" | "revise" | "watch" | "approve_for_replay" | "approve_for_forward_test";
  metrics: RankingMetrics; similarityConfidence: number; evidenceFreshness: number; lineageEventIds: string[]; assetClass: string; timeframe: string; horizon: string; correlationCluster: string; rawReturn: number;
};
export type RankedStrategy = RankingCandidateInput & { score: number; rank: number; status: ResearchStrategyStatus; reasons: string[] };
export type StrategyDecision = { strategyId: string; status: ResearchStrategyStatus; reason: string };
export type ResearchPortfolioSelection = { maxFocusedCount: number; strategies: RankedStrategy[]; constraints: Record<string, unknown> };
export type StrategyRankingDecision = { rankingId: string; policyVersion: string; generatedAt: string; candidates: RankedStrategy[]; focusedPortfolio: ResearchPortfolioSelection; demotions: StrategyDecision[]; retirements: StrategyDecision[]; evidenceGaps: StrategyDecision[]; correlationMatrixReference: string; correlationId: string; causationId: string | null };
export type RankingRequest = { candidates: RankingCandidateInput[]; maxFocusedCount: number; correlationId: string; causationId: string | null; generatedAt?: string };
