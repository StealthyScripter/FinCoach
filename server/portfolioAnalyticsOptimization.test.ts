import assert from "node:assert/strict";
import { correlationMatrix, covarianceMatrix, herfindahl, rankLeaderboards, returnsFromBars, riskStatistics } from "./portfolio/analytics";
import { optimizePortfolio } from "./portfolio/optimization";
import { mandatePolicy, validateMandate } from "./portfolio/mandates";
import type { PortfolioHistoricalBar, PortfolioSummary } from "./portfolio/domain";

const spyBars = bars("SPY", [100, 101, 102, 101, 104, 106, 105]);
const aggBars = bars("AGG", [100, 100.2, 100.1, 100.4, 100.6, 100.5, 100.8]);
const spy = returnsFromBars("SPY", spyBars);
const agg = returnsFromBars("AGG", aggBars);
assert.equal(spy.returns.length, 6);
const stats = riskStatistics(spy.returns);
assert.equal(stats.observations, 6);
assert.ok(stats.volatility! > 0);
assert.ok(stats.maxDrawdownPct > 0);
assert.ok(stats.var95 !== null);

const cov = covarianceMatrix([spy, agg]);
assert.equal(cov.length, 2);
assert.equal(correlationMatrix([spy, agg])[0][0], 1);
assert.ok(herfindahl([0.5, 0.5]) < herfindahl([0.9, 0.1]));

const minVariance = optimizePortfolio({ series: [spy, agg], objective: "minimum_variance", maxWeight: 0.9 });
const maxSharpe = optimizePortfolio({ series: [spy, agg], objective: "max_sharpe", maxWeight: 0.9 });
assert.equal(minVariance.weights.length, 2);
assert.ok(minVariance.volatility <= maxSharpe.volatility || maxSharpe.expectedReturn >= minVariance.expectedReturn);
assert.throws(() => optimizePortfolio({ series: [{ symbol: "BAD", returns: [0.01] }], objective: "balanced" }), /portfolio_insufficient_history/);

const conservative = mandatePolicy({ riskLevel: 2, mandate: "capital_preservation" });
const aggressive = mandatePolicy({ riskLevel: 8, mandate: "growth" });
assert.ok(conservative.maxVolatilityPct < aggressive.maxVolatilityPct);
assert.equal(conservative.leverageAllowed, false);
const mandate = validateMandate({ strategy: { riskLevel: 2, mandate: "capital_preservation" }, singlePositionPct: 40, assetClassPct: 80, cashPct: 2, positions: 1, volatilityPct: 10, drawdownPct: 12 });
assert.equal(mandate.ok, false);
assert.ok(mandate.breaches.some((item) => item.code === "max_single_position"));

const portfolios: PortfolioSummary[] = [
  summary("MATURE", 5, 8, 4, "alpha-vantage"),
  summary("LUCKY", 8, 8.5, 1, "alpha-vantage"),
  summary("FIX", 3, 10, 2, "portfolio-fixture-market-data"),
];
const leaderboards = rankLeaderboards(portfolios);
assert.equal(leaderboards.overall[0].shortName, "MATURE");
assert.equal(leaderboards.highestReturn[0].shortName, "LUCKY");
assert.ok(leaderboards.experimental.length >= 0);

function bars(symbol: string, closes: number[]): PortfolioHistoricalBar[] {
  return closes.map((close, index) => ({ symbol, assetClass: "etf", open: close, high: close, low: close, close, adjustedClose: close, volume: 1000, dividendAmount: 0, splitCoefficient: 1, observedAt: new Date(Date.UTC(2026, 0, index + 1, 21)).toISOString(), source: "fixture", fixture: true }));
}

function summary(shortName: string, riskLevel: number, allTimePct: number, weeklyPct: number, providerSource: string): PortfolioSummary {
  return { portfolioId: shortName, strategyId: shortName, shortName, name: shortName, description: "", riskLevel, riskLabel: "", mandate: riskLevel >= 9 ? "experimental" : "growth", lifecycleState: riskLevel >= 9 ? "RESEARCH" : "VIRTUAL_LIVE_DATA", rank: null, nav: 100, cash: 0, marketValue: 100, dailyPnl: 0, dailyPct: 0, weeklyPnl: weeklyPct, weeklyPct, allTimePnl: allTimePct, allTimePct, stale: false, providerSource, benchmarkSymbol: "SPY" };
}
