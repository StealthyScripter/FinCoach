import type { PortfolioHistoricalBar, PortfolioSummary } from "./domain";

export type ReturnSeries = { symbol: string; returns: number[] };

export function returnsFromBars(symbol: string, bars: PortfolioHistoricalBar[]): ReturnSeries {
  const ordered = [...bars].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const returns = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].adjustedClose ?? ordered[index - 1].close;
    const current = ordered[index].adjustedClose ?? ordered[index].close;
    if (previous > 0 && Number.isFinite(current)) returns.push(current / previous - 1);
  }
  return { symbol, returns };
}

export function riskStatistics(series: number[], riskFreeRateDaily = 0) {
  if (series.length < 2) return insufficient();
  const mean = average(series);
  const varianceValue = variance(series);
  const volatility = Math.sqrt(Math.max(0, varianceValue)) * Math.sqrt(252);
  const downside = series.filter((value) => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(average(downside.map((value) => value * value))) * Math.sqrt(252) : 0;
  const sharpe = volatility > 0 ? (mean - riskFreeRateDaily) * 252 / volatility : null;
  const sortino = downsideDeviation > 0 ? (mean - riskFreeRateDaily) * 252 / downsideDeviation : null;
  const sorted = [...series].sort((a, b) => a - b);
  const varIndex = Math.max(0, Math.floor(sorted.length * 0.05) - 1);
  const var95 = Math.abs(sorted[varIndex] ?? 0);
  const tail = sorted.slice(0, Math.max(1, varIndex + 1));
  const cvar95 = Math.abs(average(tail));
  return { observations: series.length, expectedReturn: mean * 252, variance: varianceValue, volatility, downsideDeviation, sharpe, sortino, maxDrawdownPct: maxDrawdown(series), var95, cvar95 };
}

export function covarianceMatrix(series: ReturnSeries[]) {
  if (!series.length) return [];
  const minLength = Math.min(...series.map((item) => item.returns.length));
  if (minLength < 2) throw new Error("portfolio_insufficient_history");
  return series.map((left) => series.map((right) => covariance(left.returns.slice(-minLength), right.returns.slice(-minLength))));
}

export function correlationMatrix(series: ReturnSeries[]) {
  const cov = covarianceMatrix(series);
  return cov.map((row, i) => row.map((value, j) => {
    const denom = Math.sqrt(cov[i][i] * cov[j][j]);
    return denom > 0 ? value / denom : i === j ? 1 : 0;
  }));
}

export function portfolioVolatility(weights: number[], covariance: number[][]) {
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) for (let j = 0; j < weights.length; j += 1) total += weights[i] * weights[j] * covariance[i][j];
  return Math.sqrt(Math.max(0, total)) * Math.sqrt(252);
}

export function herfindahl(weights: number[]) {
  return weights.reduce((sum, weight) => sum + weight * weight, 0);
}

export function rankLeaderboards(portfolios: PortfolioSummary[]) {
  const mature = (item: PortfolioSummary) => confidencePenalty(item);
  return {
    overall: rankBy(portfolios, (item) => item.allTimePct - item.riskLevel * 0.2 + mature(item)),
    highestReturn: rankBy(portfolios, (item) => item.allTimePct + mature(item)),
    bestRiskAdjusted: rankBy(portfolios, (item) => item.allTimePct / Math.max(1, item.riskLevel) + mature(item)),
    lowestRisk: rankBy(portfolios, (item) => -item.riskLevel + mature(item)),
    bestDrawdownControl: rankBy(portfolios, (item) => -Math.max(0, -item.allTimePct) - item.riskLevel * 0.05 + mature(item)),
    bestIncome: rankBy(portfolios.filter((item) => item.mandate === "income" || item.mandate === "capital_preservation"), (item) => item.allTimePct + mature(item)),
    bestRecent: rankBy(portfolios, (item) => item.dailyPct + item.weeklyPct + mature(item)),
    bestLongTerm: rankBy(portfolios, (item) => item.allTimePct + mature(item) * 2),
    experimental: rankBy(portfolios.filter((item) => item.mandate === "experimental" || item.riskLevel >= 10), (item) => item.allTimePct + mature(item)),
  };
}

function rankBy(items: PortfolioSummary[], score: (item: PortfolioSummary) => number) {
  return [...items].map((item) => ({ ...item, score: score(item) })).sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, leaderboardRank: index + 1, confidence: confidencePenalty(item) }));
}

function confidencePenalty(item: PortfolioSummary) {
  return item.providerSource.includes("fixture") ? -5 : item.stale ? -2 : 0.5;
}

function insufficient() {
  return { observations: 0, expectedReturn: null, variance: null, volatility: null, downsideDeviation: null, sharpe: null, sortino: null, maxDrawdownPct: 0, var95: null, cvar95: null };
}

function covariance(a: number[], b: number[]) {
  const meanA = average(a);
  const meanB = average(b);
  return a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0) / (a.length - 1);
}

function variance(values: number[]) {
  return covariance(values, values);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function maxDrawdown(returns: number[]) {
  let peak = 1;
  let equity = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, (peak - equity) / peak * 100);
  }
  return Number(drawdown.toFixed(4));
}
