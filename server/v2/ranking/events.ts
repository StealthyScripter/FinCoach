export const RankingV2EventTypes = {
  StrategyRankingComputed: "StrategyRankingComputed",
  StrategyPromotedToFocusedResearch: "StrategyPromotedToFocusedResearch",
  StrategyDemotedFromFocusedResearch: "StrategyDemotedFromFocusedResearch",
  StrategyResearchPaused: "StrategyResearchPaused",
  StrategyResearchRetired: "StrategyResearchRetired",
  StrategyEvidenceGapDetected: "StrategyEvidenceGapDetected",
  ResearchPortfolioSelected: "ResearchPortfolioSelected",
  StrategyCorrelationClusterDetected: "StrategyCorrelationClusterDetected",
} as const;
