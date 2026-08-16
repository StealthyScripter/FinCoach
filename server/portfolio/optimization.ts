import { covarianceMatrix, herfindahl, portfolioVolatility, type ReturnSeries } from "./analytics";

export type OptimizationObjective = "minimum_variance" | "max_sharpe" | "risk_parity" | "balanced" | "maximum_return";

export function optimizePortfolio(input: { series: ReturnSeries[]; objective: OptimizationObjective; maxWeight?: number; minWeight?: number; riskFreeRateDaily?: number }) {
  if (input.series.length === 0) throw new Error("portfolio_no_assets");
  const minLength = Math.min(...input.series.map((item) => item.returns.length));
  if (minLength < 3) throw new Error("portfolio_insufficient_history");
  const cov = covarianceMatrix(input.series);
  const expected = input.series.map((item) => average(item.returns.slice(-minLength)) * 252);
  const candidates = candidateWeights(input.series.length, input.maxWeight ?? 0.5, input.minWeight ?? 0);
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const weights of candidates) {
    const expectedReturn = dot(weights, expected);
    const vol = portfolioVolatility(weights, cov);
    const score = scoreWeights(input.objective, expectedReturn, vol, weights, cov);
    if (Number.isFinite(score) && score > bestScore) {
      bestScore = score;
      best = weights;
    }
  }
  return { weights: input.series.map((item, index) => ({ symbol: item.symbol, weight: round(best[index]) })), expectedReturn: round(dot(best, expected)), volatility: round(portfolioVolatility(best, cov)), concentration: round(herfindahl(best)), objective: input.objective };
}

function scoreWeights(objective: OptimizationObjective, expectedReturn: number, volatility: number, weights: number[], cov: number[][]) {
  if (objective === "minimum_variance") return -volatility;
  if (objective === "max_sharpe") return volatility > 0 ? expectedReturn / volatility : -Infinity;
  if (objective === "maximum_return") return expectedReturn - volatility * 0.25 - herfindahl(weights);
  if (objective === "risk_parity") return -riskContributionDispersion(weights, cov);
  return expectedReturn - volatility - herfindahl(weights);
}

function candidateWeights(count: number, maxWeight: number, minWeight: number) {
  if (count === 1) return [[1]];
  const step = count <= 4 ? 0.1 : 0.2;
  const results: number[][] = [];
  const current = Array(count).fill(0);
  function walk(index: number, remaining: number) {
    if (index === count - 1) {
      current[index] = Number(remaining.toFixed(10));
      if (current.every((value) => value >= minWeight - 1e-9 && value <= maxWeight + 1e-9)) results.push([...current]);
      return;
    }
    for (let value = minWeight; value <= Math.min(maxWeight, remaining); value += step) {
      current[index] = Number(value.toFixed(10));
      walk(index + 1, Number((remaining - current[index]).toFixed(10)));
    }
  }
  walk(0, 1);
  return results.length ? results : [Array(count).fill(1 / count)];
}

function riskContributionDispersion(weights: number[], cov: number[][]) {
  const vol = portfolioVolatility(weights, cov) / Math.sqrt(252);
  if (vol <= 0) return Infinity;
  const contributions = weights.map((weight, i) => weight * weights.reduce((sum, w, j) => sum + w * cov[i][j], 0) / (vol * vol));
  const target = 1 / weights.length;
  return contributions.reduce((sum, value) => sum + Math.abs(value - target), 0);
}

function dot(a: number[], b: number[]) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number) {
  return Number(value.toFixed(6));
}
