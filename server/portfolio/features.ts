import type { PortfolioHistoricalBar } from "./domain";
import { correlationMatrix, returnsFromBars, riskStatistics, type ReturnSeries } from "./analytics";

export type PortfolioFeatureSet = {
  symbol: string;
  observedAt: string;
  returns: number[];
  rollingReturn20d: number | null;
  momentum60d: number | null;
  trendStrength: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number;
  volumeTrend: number | null;
  provenance: { source: string; windowStart: string; windowEnd: string; fixture: boolean };
};

export function calculateFeatures(symbol: string, bars: PortfolioHistoricalBar[]): PortfolioFeatureSet {
  const ordered = [...bars].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (ordered.length < 2) throw new Error("portfolio_insufficient_history");
  const returns = returnsFromBars(symbol, ordered).returns;
  const stats = riskStatistics(returns);
  return {
    symbol,
    observedAt: ordered.at(-1)!.observedAt,
    returns,
    rollingReturn20d: periodReturn(ordered, 20),
    momentum60d: periodReturn(ordered, 60),
    trendStrength: trendStrength(ordered),
    volatilityPct: stats.volatility === null ? null : Number((stats.volatility * 100).toFixed(6)),
    maxDrawdownPct: stats.maxDrawdownPct,
    volumeTrend: volumeTrend(ordered),
    provenance: { source: ordered.at(-1)!.source, windowStart: ordered[0].observedAt, windowEnd: ordered.at(-1)!.observedAt, fixture: ordered.some((bar) => bar.fixture) },
  };
}

export function crossAssetFeatures(series: ReturnSeries[]) {
  return { correlation: correlationMatrix(series), symbols: series.map((item) => item.symbol), provenance: { observations: Math.min(...series.map((item) => item.returns.length)) } };
}

function periodReturn(bars: PortfolioHistoricalBar[], days: number) {
  if (bars.length <= days) return null;
  const start = bars.at(-(days + 1))!;
  const end = bars.at(-1)!;
  const startPrice = start.adjustedClose ?? start.close;
  const endPrice = end.adjustedClose ?? end.close;
  return startPrice > 0 ? Number(((endPrice / startPrice - 1) * 100).toFixed(6)) : null;
}

function trendStrength(bars: PortfolioHistoricalBar[]) {
  const sample = bars.slice(-Math.min(50, bars.length));
  if (sample.length < 5) return null;
  const first = sample[0].adjustedClose ?? sample[0].close;
  const last = sample.at(-1)!.adjustedClose ?? sample.at(-1)!.close;
  const upDays = sample.slice(1).filter((bar, index) => (bar.adjustedClose ?? bar.close) > (sample[index].adjustedClose ?? sample[index].close)).length;
  return Number((((last / first - 1) * 0.7 + upDays / (sample.length - 1) * 0.3) * 100).toFixed(6));
}

function volumeTrend(bars: PortfolioHistoricalBar[]) {
  if (bars.length < 20) return null;
  const recent = average(bars.slice(-10).map((bar) => bar.volume));
  const prior = average(bars.slice(-20, -10).map((bar) => bar.volume));
  return prior > 0 ? Number(((recent / prior - 1) * 100).toFixed(6)) : null;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
