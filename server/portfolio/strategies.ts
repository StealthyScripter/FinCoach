import type { PortfolioMandate, PortfolioStrategy } from "./domain";

type Seed = {
  shortName: string;
  name: string;
  mandate: PortfolioMandate;
  riskLevel: number;
  riskLabel: string;
  benchmarkSymbol: string;
  description: string;
  hypothesis: string;
  parameters: Record<string, unknown>;
};

export const PORTFOLIO_SEED_STRATEGIES: Seed[] = [
  seed("CAPSAFE", "Capital Preservation", "capital_preservation", 1, "Capital Preservation", "BIL", "Treasury-bill and cash-alternative mandate focused on nominal capital stability.", "Short-duration Treasury exposure should reduce drawdown and liquidity risk.", { targetVolatilityPct: 1, maxEquityPct: 0 }),
  seed("ULTRACON", "Ultra Conservative", "capital_preservation", 2, "Very Low", "SHY", "Short-duration income portfolio with minimal equity beta.", "Short Treasury and cash-like ETFs can improve yield while preserving low drawdown.", { targetVolatilityPct: 2, maxEquityPct: 10 }),
  seed("CASHALT", "Short Duration Cash Alternative", "income", 2, "Very Low", "BIL", "Cash-alternative strategy using short-duration instruments.", "Rolling short-duration fixed income can outperform idle cash after costs.", { targetVolatilityPct: 2, maxDurationYears: 1 }),
  seed("CONINC", "Conservative Income", "income", 3, "Low", "AGG", "Income-first conservative allocation.", "High-quality bonds plus dividend quality can improve income without equity-like drawdowns.", { targetYieldPct: 3, maxEquityPct: 25 }),
  seed("BONDINC", "Bond Income", "income", 3, "Low", "AGG", "Core bond and income mandate.", "Diversified investment-grade bond exposure should offer lower volatility than equities.", { targetDurationYears: 5, maxCreditRisk: "investment_grade" }),
  seed("DIVQUAL", "Dividend Quality", "income", 4, "Moderate-Low", "VIG", "Dividend growers and quality income equities.", "Sustainable dividend growth can produce lower drawdown than broad high-yield equity screens.", { dividendGrowthYearsMin: 5, maxSingleNamePct: 8 }),
  seed("LOWVOL", "Low Volatility", "risk_adjusted", 4, "Moderate-Low", "USMV", "Low-volatility equity and defensive allocation.", "Lower beta equity baskets should improve drawdown-adjusted return.", { maxBeta: 0.8, rebalanceBandPct: 5 }),
  seed("MINVAR", "Minimum Variance", "risk_adjusted", 4, "Moderate-Low", "USMV", "Minimum variance allocation across liquid ETFs.", "Covariance-aware allocation can reduce portfolio variance without fully exiting growth assets.", { optimizer: "minimum_variance", maxAssetPct: 35 }),
  seed("RISKPAR", "Risk Parity", "balanced", 5, "Moderate", "AOR", "Risk-balanced allocation across equity, bonds, commodities and cash proxies.", "Equal risk contribution can improve regime robustness.", { optimizer: "risk_parity", maxRiskContributionPct: 25 }),
  seed("BAL60", "Balanced 60/40", "balanced", 5, "Moderate", "AOM", "Traditional balanced equity/fixed-income reference allocation.", "A diversified 60/40 portfolio provides a stable baseline for comparing new strategies.", { equityPct: 60, bondPct: 40 }),
  seed("DIVGRO", "Diversified Growth", "growth", 6, "Moderate-Growth", "VTI", "Broad diversified growth portfolio.", "Broad equity exposure plus defensive ballast can compound while limiting concentration.", { maxEquityPct: 80, maxSectorPct: 25 }),
  seed("VALUE", "Value", "growth", 6, "Moderate-Growth", "VTV", "Value factor allocation.", "Valuation discipline can improve long-run expected return with cyclical risk.", { factor: "value", maxSingleNamePct: 6 }),
  seed("QUALITY", "Quality", "growth", 6, "Moderate-Growth", "QUAL", "Quality factor strategy.", "High profitability and balance-sheet quality should improve downside resilience.", { factor: "quality", minProfitabilityScore: 0.7 }),
  seed("FACTOR", "Multi-Factor", "risk_adjusted", 7, "Growth", "VFMO", "Combined quality, value, momentum and low-volatility factor portfolio.", "Diversified factors may reduce single-factor crowding risk.", { factors: ["quality", "value", "momentum", "low_volatility"] }),
  seed("MOMENT", "Momentum", "growth", 7, "Growth", "MTUM", "Momentum equity strategy.", "Persistent relative strength can outperform but requires turnover control.", { factor: "momentum", maxTurnoverPct: 80 }),
  seed("TREND", "Trend Following", "risk_adjusted", 7, "Growth", "DBMF", "Trend and managed-futures proxy mandate.", "Cross-asset trend exposure can diversify equity bear-market risk.", { trendLookbackDays: 120, maxCommodityPct: 30 }),
  seed("MAXSHARPE", "Maximum Sharpe", "risk_adjusted", 8, "Aggressive", "AOR", "Risk-adjusted optimizer emphasizing Sharpe under explicit concentration limits.", "Expected return should be maximized only inside risk and concentration constraints.", { optimizer: "max_sharpe", minConfidence: 0.65 }),
  seed("AGGRO", "Aggressive Growth", "growth", 8, "Aggressive", "QQQ", "High-growth equity and innovation allocation.", "Higher volatility growth assets may outperform over long horizons with large drawdowns.", { maxEquityPct: 100, maxDrawdownBudgetPct: 30 }),
  seed("HIGHRET", "High Risk High Return", "maximum_return", 9, "Very Aggressive", "QQQ", "Return-maximizing virtual strategy with explicit high drawdown tolerance.", "Concentrated growth/factor exposure may outperform but requires strict virtual-only containment.", { maxSingleThemePct: 40, drawdownBudgetPct: 40 }),
  seed("EXPADAPT", "Experimental Adaptive", "experimental", 10, "Maximum-Risk Experimental", "SPY", "Experimental strategy for adaptive research mutations.", "Adaptive parameter mutation may discover robust ideas, but evidence confidence starts low.", { experimental: true, mutationRate: 0.1 }),
];

export function instantiateSeedStrategies(startingCapital: number, now = new Date()): PortfolioStrategy[] {
  return PORTFOLIO_SEED_STRATEGIES.map((item) => ({
    id: `portfolio-strategy-${item.shortName.toLowerCase()}`,
    shortName: item.shortName,
    name: item.name,
    description: item.description,
    mandate: item.mandate,
    riskLevel: item.riskLevel,
    riskLabel: item.riskLabel,
    lifecycleState: item.riskLevel >= 10 ? "RESEARCH" : "VIRTUAL_LIVE_DATA",
    strategyVersion: 1,
    parentStrategyId: null,
    researchHypothesis: item.hypothesis,
    parameters: item.parameters,
    benchmarkSymbol: item.benchmarkSymbol,
    startingCapital,
    currency: "USD",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
}

function seed(shortName: string, name: string, mandate: PortfolioMandate, riskLevel: number, riskLabel: string, benchmarkSymbol: string, description: string, hypothesis: string, parameters: Record<string, unknown>): Seed {
  return { shortName, name, mandate, riskLevel, riskLabel, benchmarkSymbol, description, hypothesis, parameters };
}
