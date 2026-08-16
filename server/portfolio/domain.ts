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

export type PortfolioTransaction = {
  id: string;
  portfolioId: string;
  idempotencyKey: string;
  side: "BUY" | "SELL";
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  price: number;
  fee: number;
  realizedPnl: number;
  reason: string;
  evidence: Record<string, unknown>;
  executedAt: string;
};

export type PortfolioOrder = {
  id: string;
  portfolioId: string;
  idempotencyKey: string;
  side: "BUY" | "SELL" | "HOLD" | "REBALANCE";
  symbol: string | null;
  assetClass: AssetClass | null;
  quantity: number | null;
  status: "accepted" | "filled" | "rejected" | "cancelled";
  reason: string;
  submittedAt: string;
  filledAt: string | null;
  evidence: Record<string, unknown>;
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

export type PortfolioHistoricalBar = {
  symbol: string;
  assetClass: AssetClass;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number;
  dividendAmount: number | null;
  splitCoefficient: number | null;
  observedAt: string;
  source: string;
  fixture: boolean;
};

export type PortfolioInstrument = {
  instrumentId: string;
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  subtype: string | null;
  exchange: string | null;
  currency: "USD";
  country: string | null;
  sector: string | null;
  industry: string | null;
  marketCalendar: string;
  tickSize: number | null;
  lotSize: number | null;
  contractMultiplier: number | null;
  underlying: string | null;
  optionStrike: number | null;
  optionExpiration: string | null;
  optionType: "call" | "put" | null;
  bondMaturity: string | null;
  coupon: number | null;
  providerMappings: Record<string, string>;
  benchmarkEligible: boolean;
  status: "active" | "unsupported" | "delisted";
};

export type PortfolioAccountingSnapshot = {
  portfolioId: string;
  cash: number;
  marketValue: number;
  nav: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  allTimePnl: number;
  dailyPct: number;
  weeklyPct: number;
  monthlyPct: number;
  allTimePct: number;
  fees: number;
  turnover: number;
  observedAt: string;
};

export type PortfolioMarketStatus = {
  market: string;
  region: string;
  primaryExchanges: string[];
  status: "open" | "closed" | "unknown";
  reason: "regular" | "holiday" | "outside_hours" | "provider_unavailable" | "unsupported";
  observedAt: string;
  nextOpenAt: string | null;
  nextCloseAt: string | null;
  source: string;
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
  monthlyPnl: number;
  monthlyPct: number;
  allTimePnl: number;
  allTimePct: number;
  stale: boolean;
  providerSource: string;
  benchmarkSymbol: string;
  readinessStatus?: "ready" | "not_ready";
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
  readiness?: PortfolioReadiness;
};

export type PortfolioReadiness = {
  status: "ready" | "not_ready";
  marketDataReady: boolean;
  researchReady: boolean;
  validationReady: boolean;
  virtualForwardReady: boolean;
  authReady: boolean;
  persistenceReady: boolean;
  liveExecutionBlocked: true;
  blockers: Array<{ code: string; action: string }>;
};

export type PortfolioResearchHypothesis = {
  id: string;
  strategyId: string;
  hypothesis: string;
  symbols: string[];
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  status: "created" | "validated" | "rejected" | "blocked";
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type PortfolioBacktestResult = {
  id: string;
  strategyId: string;
  hypothesisId: string;
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number | null;
  sharpe: number | null;
  turnoverPct: number;
  observations: number;
  passed: boolean;
  rejectionReason: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type PortfolioWalkForwardResult = {
  id: string;
  strategyId: string;
  backtestId: string;
  windows: Array<{ trainStart: string; trainEnd: string; validateStart: string; validateEnd: string; returnPct: number; maxDrawdownPct: number }>;
  stabilityScore: number;
  passed: boolean;
  rejectionReason: string | null;
  createdAt: string;
};

export type PortfolioForwardTestRecord = {
  id: string;
  strategyId: string;
  portfolioId: string;
  observedAt: string;
  decision: "BUY" | "SELL" | "HOLD" | "REBALANCE";
  symbol: string;
  observedPrice: number;
  assumedFillPrice: number | null;
  quantity: number | null;
  nav: number;
  cash: number;
  riskState: Record<string, unknown>;
  evidence: Record<string, unknown>;
};
