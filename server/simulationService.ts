import type { PaperPortfolio, RiskRule } from "@shared/schema";

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

const scenarioShocks: Record<ScenarioName, {
  label: string;
  equityShock: number;
  bondShock: number;
  cashShock: number;
  recoveryMonths: number;
  notes: string[];
}> = {
  "2008_crisis": {
    label: "2008 financial crisis",
    equityShock: -0.42,
    bondShock: 0.06,
    cashShock: 0,
    recoveryMonths: 48,
    notes: ["Equities fall sharply", "High-quality bonds cushion drawdown", "Liquidity matters more than yield"],
  },
  "2020_covid_crash": {
    label: "2020 COVID crash",
    equityShock: -0.34,
    bondShock: 0.03,
    cashShock: 0,
    recoveryMonths: 8,
    notes: ["Fast equity shock", "Policy response can accelerate recovery", "Forced selling risk rises"],
  },
  "2022_rate_shock": {
    label: "2022 inflation/rate shock",
    equityShock: -0.24,
    bondShock: -0.14,
    cashShock: 0.02,
    recoveryMonths: 30,
    notes: ["Stocks and bonds can fall together", "Duration exposure becomes a core risk", "Cash and bills cushion volatility"],
  },
  oil_shock: {
    label: "Oil supply shock",
    equityShock: -0.12,
    bondShock: -0.04,
    cashShock: 0,
    recoveryMonths: 18,
    notes: ["Inflation-sensitive assets reprice", "Consumer sectors may lag", "Energy exposure can offset some losses"],
  },
};

export class SimulationService {
  runScenario(portfolio: PaperPortfolio, riskRules: RiskRule[], scenario: ScenarioName): ScenarioSimulation {
    const shock = scenarioShocks[scenario];
    const stressedHoldings = portfolio.holdings.map((holding) => {
      const type = classifyHolding(holding.symbol);
      const shockPct = type === "bond" ? shock.bondShock : type === "cash" ? shock.cashShock : shock.equityShock;
      return {
        ...holding,
        shockedValue: holding.value * (1 + shockPct),
        shockPct,
      };
    });
    const stressedHoldingsValue = stressedHoldings.reduce((sum, holding) => sum + holding.shockedValue, 0);
    const cashAfterShock = portfolio.cash * (1 + shock.cashShock);
    const estimatedPortfolioValueAfter = stressedHoldingsValue + cashAfterShock;
    const estimatedDrawdownPct =
      ((estimatedPortfolioValueAfter - portfolio.totalValue) / portfolio.totalValue) * 100;
    const largestRiskContributor = stressedHoldings.reduce((largest, holding) =>
      holding.riskContribution > largest.riskContribution ? holding : largest,
    ).symbol;
    const riskBreaches = [
      estimatedDrawdownPct < -10 ? "Estimated drawdown exceeds 10% review threshold" : null,
      portfolio.cash / portfolio.totalValue < 0.05 ? "Cash below 5% liquidity threshold" : null,
      ...riskRules
        .filter((rule) => rule.status === "breached")
        .map((rule) => `Existing breached rule: ${rule.label}`),
    ].filter((item): item is string => Boolean(item));

    return {
      scenario,
      portfolioValueBefore: portfolio.totalValue,
      estimatedPortfolioValueAfter: Number(estimatedPortfolioValueAfter.toFixed(2)),
      estimatedDrawdownPct: Number(estimatedDrawdownPct.toFixed(2)),
      estimatedRecoveryMonths: shock.recoveryMonths,
      largestRiskContributor,
      liquidityWarning:
        cashAfterShock / estimatedPortfolioValueAfter < 0.05
          ? "Liquidity is thin for this stress scenario."
          : null,
      riskBreaches,
      notes: [`Scenario: ${shock.label}`, ...shock.notes],
    };
  }
}

export const simulationService = new SimulationService();

function classifyHolding(symbol: string): "equity" | "bond" | "cash" {
  if (["BND", "AGG", "TLT", "IEF"].includes(symbol.toUpperCase())) return "bond";
  if (["SGOV", "BIL", "SHV", "CASH"].includes(symbol.toUpperCase())) return "cash";
  return "equity";
}
