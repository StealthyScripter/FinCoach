import type { BacktestRequest, BacktestResult } from "@shared/schema";

type AssetClass = "us_equity" | "international_equity" | "bond" | "cash" | "satellite";

const annualReturns: Record<AssetClass, Record<number, number>> = {
  us_equity: {
    2008: -0.37, 2009: 0.26, 2010: 0.15, 2011: 0.02, 2012: 0.16, 2013: 0.32, 2014: 0.13, 2015: 0.01,
    2016: 0.12, 2017: 0.21, 2018: -0.04, 2019: 0.31, 2020: 0.18, 2021: 0.28, 2022: -0.19, 2023: 0.26,
    2024: 0.21, 2025: 0.08, 2026: 0.04,
  },
  international_equity: {
    2008: -0.43, 2009: 0.32, 2010: 0.08, 2011: -0.12, 2012: 0.18, 2013: 0.15, 2014: -0.04, 2015: -0.01,
    2016: 0.05, 2017: 0.27, 2018: -0.14, 2019: 0.22, 2020: 0.11, 2021: 0.08, 2022: -0.16, 2023: 0.15,
    2024: 0.09, 2025: 0.06, 2026: 0.03,
  },
  bond: {
    2008: 0.05, 2009: 0.06, 2010: 0.06, 2011: 0.08, 2012: 0.04, 2013: -0.02, 2014: 0.06, 2015: 0.01,
    2016: 0.03, 2017: 0.04, 2018: 0.00, 2019: 0.09, 2020: 0.08, 2021: -0.02, 2022: -0.13, 2023: 0.05,
    2024: 0.03, 2025: 0.04, 2026: 0.02,
  },
  cash: {
    2008: 0.02, 2009: 0.00, 2010: 0.00, 2011: 0.00, 2012: 0.00, 2013: 0.00, 2014: 0.00, 2015: 0.00,
    2016: 0.00, 2017: 0.01, 2018: 0.02, 2019: 0.02, 2020: 0.01, 2021: 0.00, 2022: 0.02, 2023: 0.05,
    2024: 0.05, 2025: 0.04, 2026: 0.02,
  },
  satellite: {
    2008: -0.48, 2009: 0.45, 2010: 0.22, 2011: -0.08, 2012: 0.21, 2013: 0.38, 2014: 0.09, 2015: 0.04,
    2016: 0.16, 2017: 0.32, 2018: -0.18, 2019: 0.36, 2020: 0.31, 2021: 0.24, 2022: -0.31, 2023: 0.39,
    2024: 0.18, 2025: 0.09, 2026: 0.03,
  },
};

export class BacktestingService {
  run(request: BacktestRequest): BacktestResult {
    let value = request.initialCapital;
    let highWaterMark = value;
    const annualResults: BacktestResult["annualResults"] = [];
    const yearlyReturns: number[] = [];

    for (let year = request.startYear; year <= request.endYear; year += 1) {
      const contribution = request.monthlyContribution * 12;
      const weightedReturn = this.weightedReturn(request, year);
      const rebalanceDrag = request.rebalanceFrequency === "quarterly" ? 0.0015 : request.rebalanceFrequency === "annual" ? 0.0005 : 0;
      const netReturn = weightedReturn - rebalanceDrag;

      value = (value + contribution) * (1 + netReturn);
      highWaterMark = Math.max(highWaterMark, value);
      const drawdownPct = ((value - highWaterMark) / highWaterMark) * 100;

      annualResults.push({
        year,
        contribution,
        endingValue: roundCurrency(value),
        returnPct: roundPct(netReturn * 100),
        drawdownPct: roundPct(drawdownPct),
      });
      yearlyReturns.push(netReturn);
    }

    const totalContributions = request.initialCapital + request.monthlyContribution * 12 * annualResults.length;
    const years = annualResults.length;
    const cumulativeReturnPct = ((value - totalContributions) / totalContributions) * 100;
    const annualizedReturnPct = (Math.pow(value / totalContributions, 1 / years) - 1) * 100;
    const volatilityPct = standardDeviation(yearlyReturns) * 100;
    const maxDrawdownPct = Math.min(...annualResults.map((item) => item.drawdownPct));
    const bestYear = annualResults.reduce((best, item) => item.returnPct > best.returnPct ? item : best, annualResults[0]);
    const worstYear = annualResults.reduce((worst, item) => item.returnPct < worst.returnPct ? item : worst, annualResults[0]);
    const sharpeRatio = volatilityPct > 0 ? (annualizedReturnPct - 2) / volatilityPct : 0;
    const equityAllocation = request.allocation
      .filter((item) => ["us_equity", "international_equity", "satellite"].includes(classifySymbol(item.symbol)))
      .reduce((sum, item) => sum + item.targetPct, 0);

    const riskBreaches = [
      maxDrawdownPct < -20 ? "Backtest max drawdown exceeds 20% review threshold" : null,
      worstYear.returnPct < -25 ? `Worst year ${worstYear.year} loss exceeds 25%` : null,
      equityAllocation > 85 ? "Equity-like allocation exceeds 85% tactical review threshold" : null,
      request.startYear > 2008 ? "Backtest does not include the 2008 crisis regime" : null,
      years < 5 ? "Backtest period is shorter than five years" : null,
    ].filter((item): item is string => Boolean(item));

    return {
      strategyName: request.strategyName,
      startYear: request.startYear,
      endYear: request.endYear,
      initialCapital: request.initialCapital,
      monthlyContribution: request.monthlyContribution,
      totalContributions: roundCurrency(totalContributions),
      finalValue: roundCurrency(value),
      cumulativeReturnPct: roundPct(cumulativeReturnPct),
      annualizedReturnPct: roundPct(annualizedReturnPct),
      volatilityPct: roundPct(volatilityPct),
      maxDrawdownPct: roundPct(maxDrawdownPct),
      sharpeRatio: roundPct(sharpeRatio),
      bestYear: { year: bestYear.year, returnPct: bestYear.returnPct },
      worstYear: { year: worstYear.year, returnPct: worstYear.returnPct },
      annualResults,
      riskBreaches,
      requiredActions: riskBreaches.length > 0
        ? [
            "Review drawdown tolerance before creating a rebalance ticket",
            "Compare against at least one lower-risk allocation",
            "Document what would invalidate this strategy in the journal",
          ]
        : ["Continue with paper-only monitoring and compare against scenario stress tests"],
      notes: [
        "Backtest uses deterministic MarketPilot demo return fixtures, not live market data.",
        "Results are for education and portfolio simulation only.",
        "Past performance does not guarantee future results.",
      ],
    };
  }

  private weightedReturn(request: BacktestRequest, year: number) {
    return request.allocation.reduce((sum, item) => {
      const assetClass = classifySymbol(item.symbol);
      const yearlyReturn = annualReturns[assetClass][year] ?? annualReturns[assetClass][2026];
      return sum + (item.targetPct / 100) * yearlyReturn;
    }, 0);
  }
}

export const backtestingService = new BacktestingService();

function classifySymbol(symbol: string): AssetClass {
  const upper = symbol.toUpperCase();
  if (["BND", "AGG", "TLT", "IEF"].includes(upper)) return "bond";
  if (["SGOV", "BIL", "SHV", "CASH"].includes(upper)) return "cash";
  if (["VXUS", "VEA", "VWO", "EFA", "EEM"].includes(upper)) return "international_equity";
  if (["QQQ", "ARKK", "SECTOR", "WATCHLIST"].includes(upper)) return "satellite";
  return "us_equity";
}

function standardDeviation(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function roundPct(value: number) {
  return Number(value.toFixed(2));
}
