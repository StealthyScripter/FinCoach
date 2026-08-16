export type AssetClass = "equity" | "etf" | "bond" | "index_proxy" | "option" | "commodity" | "fx" | "cash";
export type PortfolioLifecycleState = "RESEARCH" | "HISTORICAL_VALIDATION" | "WALK_FORWARD_VALIDATION" | "VIRTUAL_LIVE_DATA" | "BROKER_PAPER" | "LIVE_CANDIDATE" | "CONTROLLED_LIVE" | "RETIRED";
export type PortfolioMandate = "capital_preservation" | "income" | "balanced" | "risk_adjusted" | "growth" | "maximum_return" | "experimental";

export type PortfolioStrategy = {
  id: string;
  shortName: string;
  name: string;
  description: string;
  mandate: PortfolioMandate;
  riskLevel: number;
  riskLabel: string;
  lifecycleState: PortfolioLifecycleState;
  strategyVersion: number;
  parentStrategyId: string | null;
  researchHypothesis: string;
  parameters: Record<string, unknown>;
  benchmarkSymbol: string;
  startingCapital: number;
  currency: "USD";
  createdAt: string;
  updatedAt: string;
};

export type PortfolioAccount = {
  id: string;
  strategyId: string;
  startingCapital: number;
  cash: number;
  currency: "USD";
  status: "active" | "halted" | "retired";
  createdAt: string;
  updatedAt: string;
};

export type PortfolioPosition = {
  id: string;
  portfolioId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  currency: "USD";
  updatedAt: string;
};

export type PortfolioQuote = {
  symbol: string;
  assetClass: AssetClass;
  bid: number | null;
  ask: number | null;
  last: number;
  currency: "USD";
  observedAt: string;
  stale: boolean;
  source: string;
  fixture: boolean;
};

export type PortfolioSummary = {
  portfolioId: string;
  strategyId: string;
  shortName: string;
  name: string;
  description: string;
  riskLevel: number;
  riskLabel: string;
  mandate: PortfolioMandate;
  lifecycleState: PortfolioLifecycleState;
  rank: number | null;
  nav: number;
  cash: number;
  marketValue: number;
  dailyPnl: number;
  dailyPct: number;
  weeklyPnl: number;
  weeklyPct: number;
  allTimePnl: number;
  allTimePct: number;
  stale: boolean;
  providerSource: string;
  benchmarkSymbol: string;
};

export type PortfolioDetail = PortfolioSummary & {
  positions: Array<PortfolioPosition & { currentPrice: number | null; marketValue: number; unrealizedPnl: number; allocationPct: number; stale: boolean }>;
  decisions: PortfolioDecisionEvent[];
  metrics: PortfolioRiskMetrics;
  equityCurve: Array<{ observedAt: string; nav: number }>;
  benchmark: { symbol: string; available: boolean; reason?: string };
  lineage: { parentStrategyId: string | null; strategyVersion: number; researchHypothesis: string; parameters: Record<string, unknown> };
};

export type PortfolioRiskMetrics = {
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  var95: number | null;
  cvar95: number | null;
  concentrationPct: number;
  confidence: number;
};

export type PortfolioDecisionEvent = {
  id: string;
  portfolioId: string | null;
  strategyId: string | null;
  eventType: string;
  symbol: string | null;
  reason: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  evidence: Record<string, unknown>;
  expectedEffect: Record<string, unknown>;
  actualEffect: Record<string, unknown>;
  createdAt: string;
};

export type PortfolioHealth = {
  enabled: boolean;
  liveExecutionBlocked: true;
  runtimeState: "disabled" | "healthy" | "degraded";
  activePortfolios: number;
  experimentalStrategies: number;
  providerHealth: "disabled" | "healthy" | "degraded";
  lastSuccessfulMarketDataRefresh: string | null;
  lastRebalance: string | null;
  lastResearchCycle: string | null;
  blockers: Array<Record<string, unknown>>;
  fallbacks: Array<Record<string, unknown>>;
  marketDataAgeSeconds: number | null;
  schedulerHealth: "disabled" | "idle";
};
