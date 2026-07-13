export const MarketMemoryV2EventTypes = {
  MarketStateVectorCreated: "MarketStateVectorCreated",
  MarketStateVectorRejected: "MarketStateVectorRejected",
  SimilaritySearchCompleted: "SimilaritySearchCompleted",
  SimilaritySearchInsufficientNeighbors: "SimilaritySearchInsufficientNeighbors",
  HistoricalAnalogOutcomeComputed: "HistoricalAnalogOutcomeComputed",
  SimilarityEvidenceExpired: "SimilarityEvidenceExpired",
} as const;
