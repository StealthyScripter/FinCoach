export const MarketContextV2EventTypes = {
  MarketContextCreated: "MarketContextCreated",
  MarketSessionOpened: "MarketSessionOpened",
  MarketSessionClosed: "MarketSessionClosed",
  LiquidityConditionChanged: "LiquidityConditionChanged",
  VolatilityRegimeChanged: "VolatilityRegimeChanged",
  EventRiskWindowStarted: "EventRiskWindowStarted",
  EventRiskWindowEnded: "EventRiskWindowEnded",
} as const;
