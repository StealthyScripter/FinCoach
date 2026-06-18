import type { PaperPortfolio } from "@shared/schema";

export type PortfolioModelId =
  | "three_fund"
  | "sixty_forty"
  | "eighty_twenty"
  | "core_satellite"
  | "dividend_income"
  | "factor_portfolio"
  | "risk_parity"
  | "tactical_allocation";

export type PortfolioModelRecommendation = {
  id: PortfolioModelId;
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

const modelTargets: Record<PortfolioModelId, {
  name: string;
  level: "beginner" | "intermediate";
  objective: string;
  targets: Array<{ sleeve: string; symbol: string; targetPct: number }>;
  gates: string[];
}> = {
  three_fund: {
    name: "Three-Fund Portfolio",
    level: "beginner",
    objective: "Broad diversification across US stocks, international stocks, and bonds.",
    targets: [
      { sleeve: "US equities", symbol: "VTI", targetPct: 45 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 20 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 30 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 5 },
    ],
    gates: ["Foundation portfolio construction module", "Position sizing quiz"],
  },
  sixty_forty: {
    name: "60/40 Diversified Portfolio",
    level: "beginner",
    objective: "Balance long-term equity growth with bond ballast.",
    targets: [
      { sleeve: "US equities", symbol: "VTI", targetPct: 40 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 20 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 35 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 5 },
    ],
    gates: ["Drawdown lesson", "Rebalancing lesson"],
  },
  eighty_twenty: {
    name: "80/20 Growth Portfolio",
    level: "beginner",
    objective: "Higher equity exposure for longer horizons while preserving some defensive ballast.",
    targets: [
      { sleeve: "US equities", symbol: "VTI", targetPct: 55 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 25 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 15 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 5 },
    ],
    gates: ["Risk tolerance review", "Maximum drawdown explanation"],
  },
  core_satellite: {
    name: "Core-Satellite Portfolio",
    level: "intermediate",
    objective: "Keep a diversified core while reserving a small sleeve for tactical ideas.",
    targets: [
      { sleeve: "US equities core", symbol: "VTI", targetPct: 40 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 15 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 25 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 10 },
      { sleeve: "Tactical satellite", symbol: "WATCHLIST", targetPct: 10 },
    ],
    gates: ["Research journal discipline", "Risk management score 60+", "No options or margin required"],
  },
  dividend_income: {
    name: "Dividend Income Portfolio",
    level: "intermediate",
    objective: "Prioritize diversified equity income while retaining bond and cash ballast.",
    targets: [
      { sleeve: "Dividend equities", symbol: "SCHD", targetPct: 35 },
      { sleeve: "Broad US equities", symbol: "VTI", targetPct: 20 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 10 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 25 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 10 },
    ],
    gates: ["Tax-aware income lesson", "Yield trap assessment", "Sector concentration review"],
  },
  factor_portfolio: {
    name: "Factor Portfolio",
    level: "intermediate",
    objective: "Blend broad market exposure with value, quality, and small-cap factor tilts.",
    targets: [
      { sleeve: "Broad US equities", symbol: "VTI", targetPct: 35 },
      { sleeve: "Value factor", symbol: "VTV", targetPct: 15 },
      { sleeve: "Quality factor", symbol: "QUAL", targetPct: 15 },
      { sleeve: "Small-cap factor", symbol: "VB", targetPct: 10 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 15 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 10 },
    ],
    gates: ["Factor risk lesson", "Tracking-error assessment", "Underperformance tolerance reflection"],
  },
  risk_parity: {
    name: "Risk Parity Portfolio",
    level: "intermediate",
    objective: "Balance risk contributions across equities, bonds, inflation-sensitive assets, and cash.",
    targets: [
      { sleeve: "US equities", symbol: "VTI", targetPct: 25 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 15 },
      { sleeve: "Treasury duration", symbol: "IEF", targetPct: 25 },
      { sleeve: "Inflation hedge", symbol: "TIP", targetPct: 15 },
      { sleeve: "Gold / real assets", symbol: "GLDM", targetPct: 10 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 10 },
    ],
    gates: ["Correlation lesson", "Duration risk quiz", "Inflation scenario simulation"],
  },
  tactical_allocation: {
    name: "Tactical Allocation Portfolio",
    level: "intermediate",
    objective: "Reserve a rules-based sleeve for macro or trend tilts while keeping most assets diversified.",
    targets: [
      { sleeve: "Strategic US equities", symbol: "VTI", targetPct: 35 },
      { sleeve: "International equities", symbol: "VXUS", targetPct: 15 },
      { sleeve: "Core bonds", symbol: "BND", targetPct: 20 },
      { sleeve: "Cash / bills", symbol: "SGOV", targetPct: 15 },
      { sleeve: "Rules-based tactical sleeve", symbol: "TACTICAL", targetPct: 15 },
    ],
    gates: ["Macro regime assessment", "Backtest review", "Predefined entry and exit criteria"],
  },
};

export class PortfolioModelService {
  getRecommendations(portfolio: PaperPortfolio): PortfolioModelRecommendation[] {
    return (Object.keys(modelTargets) as PortfolioModelId[]).map((id) =>
      this.compareModel(portfolio, id),
    );
  }

  compareModel(portfolio: PaperPortfolio, modelId: PortfolioModelId): PortfolioModelRecommendation {
    const model = modelTargets[modelId];
    const currentBySymbol = new Map(
      portfolio.holdings.map((holding) => [holding.symbol.toUpperCase(), holding.allocation]),
    );
    const cashPct = (portfolio.cash / portfolio.totalValue) * 100;
    const targetAllocation = model.targets.map((target) => {
      const currentPct =
        target.symbol === "SGOV"
          ? (currentBySymbol.get(target.symbol) ?? 0) + cashPct
          : currentBySymbol.get(target.symbol) ?? 0;
      const driftPct = Number((target.targetPct - currentPct).toFixed(2));
      return {
        ...target,
        currentPct: Number(currentPct.toFixed(2)),
        driftPct,
        estimatedTradeValue: Number(((driftPct / 100) * portfolio.totalValue).toFixed(2)),
      };
    });
    const maxDriftPct = Math.max(...targetAllocation.map((item) => Math.abs(item.driftPct)));
    const turnoverEstimate = targetAllocation.reduce((sum, item) => sum + Math.abs(item.estimatedTradeValue), 0) / 2;

    return {
      id: modelId,
      name: model.name,
      level: model.level,
      objective: model.objective,
      targetAllocation,
      maxDriftPct: Number(maxDriftPct.toFixed(2)),
      turnoverEstimate: Number(turnoverEstimate.toFixed(2)),
      riskNotes: buildRiskNotes(modelId, maxDriftPct),
      suitabilityGates: model.gates,
    };
  }
}

export const portfolioModelService = new PortfolioModelService();

function buildRiskNotes(modelId: PortfolioModelId, maxDriftPct: number): string[] {
  const notes = [
    maxDriftPct > 10
      ? "Current allocation has material drift from this model."
      : "Current allocation is within a moderate drift range.",
    "All model outputs are paper guidance and still require risk review before any ticket.",
  ];

  if (modelId === "eighty_twenty") {
    notes.push("Higher equity exposure can increase drawdown depth in crisis scenarios.");
  }

  if (modelId === "core_satellite") {
    notes.push("Satellite sleeves require stronger journaling discipline and predefined exit criteria.");
  }

  if (modelId === "dividend_income") {
    notes.push("Income models require tax awareness and review of sector concentration, payout quality, and yield traps.");
  }

  if (modelId === "factor_portfolio") {
    notes.push("Factor tilts can trail the broad market for long periods and need tracking-error tolerance.");
  }

  if (modelId === "risk_parity") {
    notes.push("Risk parity depends on correlation assumptions that can fail during inflation and rate shocks.");
  }

  if (modelId === "tactical_allocation") {
    notes.push("Tactical sleeves require documented rules; discretionary overrides should trigger review.");
  }

  return notes;
}
