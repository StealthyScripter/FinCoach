import type { PaperPortfolio, PortfolioRiskAnalytics } from "@shared/schema";

type AssetClass = "equity" | "international_equity" | "bond" | "cash";

const riskAssumptions: Record<AssetClass, {
  annualVolatility: number;
  beta: number;
  downsideVolatility: number;
}> = {
  equity: { annualVolatility: 0.18, beta: 1, downsideVolatility: 0.13 },
  international_equity: { annualVolatility: 0.2, beta: 0.9, downsideVolatility: 0.15 },
  bond: { annualVolatility: 0.07, beta: 0.15, downsideVolatility: 0.05 },
  cash: { annualVolatility: 0.01, beta: 0, downsideVolatility: 0.005 },
};

const correlations: Record<AssetClass, Record<AssetClass, number>> = {
  equity: { equity: 1, international_equity: 0.82, bond: 0.22, cash: 0.02 },
  international_equity: { equity: 0.82, international_equity: 1, bond: 0.18, cash: 0.02 },
  bond: { equity: 0.22, international_equity: 0.18, bond: 1, cash: 0.15 },
  cash: { equity: 0.02, international_equity: 0.02, bond: 0.15, cash: 1 },
};

export class PortfolioRiskAnalyticsService {
  analyze(portfolio: PaperPortfolio, now = new Date()): PortfolioRiskAnalytics {
    const positions = [
      ...portfolio.holdings.map((holding) => ({
        symbol: holding.symbol,
        allocation: holding.allocation / 100,
        assetClass: classifyHolding(holding.symbol),
      })),
      {
        symbol: "CASH",
        allocation: portfolio.cash / portfolio.totalValue,
        assetClass: "cash" as const,
      },
    ];
    const variance = positions.reduce((sum, left) => {
      const leftRisk = riskAssumptions[left.assetClass];
      return sum + positions.reduce((inner, right) => {
        const rightRisk = riskAssumptions[right.assetClass];
        return inner + left.allocation * right.allocation * leftRisk.annualVolatility * rightRisk.annualVolatility * correlations[left.assetClass][right.assetClass];
      }, 0);
    }, 0);
    const annualVolatility = Math.sqrt(variance);
    const oneMonthVolatility = annualVolatility / Math.sqrt(12);
    const valueAtRisk95 = portfolio.totalValue * 1.65 * oneMonthVolatility;
    const conditionalValueAtRisk95 = valueAtRisk95 * 1.28;
    const beta = positions.reduce((sum, position) =>
      sum + position.allocation * riskAssumptions[position.assetClass].beta,
    0);
    const downsideVolatility = positions.reduce((sum, position) =>
      sum + position.allocation * riskAssumptions[position.assetClass].downsideVolatility,
    0);
    const expectedExcessReturn = 0.045;
    const cashPct = (portfolio.cash / portfolio.totalValue) * 100;
    const largestHolding = portfolio.holdings.reduce((largest, holding) =>
      holding.allocation > largest.allocation ? holding : largest,
    portfolio.holdings[0]);
    const liquidityScore = Math.max(0, Math.min(100, Math.round(cashPct * 6 + (portfolio.holdings.some((holding) => holding.symbol === "SGOV") ? 20 : 0))));
    const concentrationScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, largestHolding.allocation - 15) * 4)));
    const correlationMatrix = buildCorrelationMatrix(positions);
    const riskBreaches = [
      largestHolding.allocation > 35 ? `Largest holding ${largestHolding.symbol} exceeds 35% concentration review threshold` : null,
      cashPct < 5 ? "Cash below 5% liquidity threshold" : null,
      annualVolatility > 0.16 ? "Estimated annualized volatility above 16%" : null,
      beta > 0.8 ? "Portfolio beta above 0.80 for Foundation Mode" : null,
    ].filter((item): item is string => Boolean(item));

    return {
      portfolioId: portfolio.id,
      generatedAt: now.toISOString(),
      totalValue: portfolio.totalValue,
      valueAtRisk95: roundCurrency(valueAtRisk95),
      conditionalValueAtRisk95: roundCurrency(conditionalValueAtRisk95),
      estimatedAnnualVolatilityPct: roundPct(annualVolatility * 100),
      maxDrawdownPct: portfolio.maxDrawdownPct,
      beta: roundPct(beta),
      sharpeRatio: roundPct(expectedExcessReturn / annualVolatility),
      sortinoRatio: roundPct(expectedExcessReturn / downsideVolatility),
      liquidityScore,
      concentrationScore,
      largestPosition: {
        symbol: largestHolding.symbol,
        allocation: largestHolding.allocation,
      },
      correlationMatrix,
      riskBreaches,
      requiredActions: riskBreaches.length > 0
        ? [
            "Review portfolio risk before creating new tickets",
            "Use scenario simulation before increasing equity exposure",
            "Document liquidity and concentration rationale in the journal",
          ]
        : ["Continue monitoring drift, liquidity, and drawdown metrics"],
    };
  }
}

export const portfolioRiskAnalyticsService = new PortfolioRiskAnalyticsService();

function classifyHolding(symbol: string): AssetClass {
  const upper = symbol.toUpperCase();
  if (["BND", "AGG", "TLT", "IEF"].includes(upper)) return "bond";
  if (["SGOV", "BIL", "SHV", "CASH"].includes(upper)) return "cash";
  if (["VXUS", "VEA", "VWO", "EFA", "EEM"].includes(upper)) return "international_equity";
  return "equity";
}

function buildCorrelationMatrix(positions: Array<{ symbol: string; assetClass: AssetClass }>) {
  const unique = positions.filter((position, index) =>
    positions.findIndex((item) => item.symbol === position.symbol) === index,
  );
  const pairs: Array<{ pair: string; correlation: number }> = [];
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
      const left = unique[leftIndex];
      const right = unique[rightIndex];
      pairs.push({
        pair: `${left.symbol}/${right.symbol}`,
        correlation: correlations[left.assetClass][right.assetClass],
      });
    }
  }
  return pairs;
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function roundPct(value: number) {
  return Number(value.toFixed(2));
}
