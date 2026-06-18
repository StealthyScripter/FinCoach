import { z } from "zod";
import { normalizeSymbol } from "./domain";

export const ohlcvSchema = z.object({
  timestamp: z.string().datetime(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
});

export const marketBacktestRequestSchema = z.object({
  strategyName: z.string().min(1),
  instrument: z.string().min(1),
  initialCapital: z.number().positive(),
  riskPerTradePct: z.number().positive().max(5),
  leverage: z.number().positive().max(50).default(1),
  spread: z.number().nonnegative().default(0),
  slippage: z.number().nonnegative().default(0),
  commissionPerTrade: z.number().nonnegative().default(0),
  stopLossPips: z.number().positive(),
  takeProfitPips: z.number().positive(),
  trailingStopPips: z.number().positive().optional(),
  walkForwardRatio: z.number().min(0.5).max(0.9).default(0.7),
  monteCarloRuns: z.number().int().min(0).max(2_000).default(200),
  series: z.array(ohlcvSchema).min(3),
});

export type MarketBacktestRequest = z.infer<typeof marketBacktestRequestSchema>;

type Trade = {
  entry: number;
  exit: number;
  pnl: number;
  rMultiple: number;
  outcome: "win" | "loss";
};

export class MarketBacktestingService {
  run(input: MarketBacktestRequest) {
    const request = marketBacktestRequestSchema.parse(input);
    const instrument = normalizeSymbol(request.instrument);
    if (!instrument) throw new Error("Unsupported forex or commodity instrument");

    const splitIndex = Math.max(2, Math.floor(request.series.length * request.walkForwardRatio));
    const train = request.series.slice(0, splitIndex);
    const test = request.series.slice(splitIndex - 1);
    const trades = this.simulate(request, test.length >= 2 ? test : train, instrument.pipSize, instrument.lotSize, instrument.marginRequirement);
    const metrics = calculateMetrics(request.initialCapital, trades);
    const monteCarlo = monteCarloRiskOfRuin(trades.map((trade) => trade.pnl), request.initialCapital, request.monteCarloRuns);

    return {
      strategyName: request.strategyName,
      instrument: instrument.symbol,
      assetClass: instrument.assetClass,
      trainBars: train.length,
      testBars: test.length,
      walkForwardSplit: request.walkForwardRatio,
      tradeCount: trades.length,
      ...metrics,
      riskOfRuinPct: monteCarlo.riskOfRuinPct,
      monteCarloWorstEndingEquity: monteCarlo.worstEndingEquity,
      trades,
      assumptions: {
        spread: request.spread,
        slippage: request.slippage,
        commissionPerTrade: request.commissionPerTrade,
        leverage: request.leverage,
        marginRequirement: instrument.marginRequirement,
        pipValuePerLot: pipValue(instrument.pipSize, instrument.lotSize),
        trailingStopPips: request.trailingStopPips ?? null,
      },
    };
  }

  private simulate(request: MarketBacktestRequest, series: MarketBacktestRequest["series"], pipSize: number, lotSize: number, marginRequirement: number): Trade[] {
    const trades: Trade[] = [];
    let equity = request.initialCapital;
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1];
      const bar = series[index];
      const side = previous.close >= previous.open ? 1 : -1;
      const entry = bar.open + side * (request.spread / 2 + request.slippage);
      const stopDistance = request.stopLossPips * pipSize;
      const targetDistance = request.takeProfitPips * pipSize;
      const riskBudget = equity * request.riskPerTradePct / 100;
      const rawLots = riskBudget / (request.stopLossPips * pipValue(pipSize, lotSize));
      const maxLotsByMargin = equity * request.leverage / (entry * lotSize * marginRequirement);
      const lots = Math.max(0, Math.min(rawLots, maxLotsByMargin));
      if (!Number.isFinite(lots) || lots <= 0) continue;

      let exit = bar.close;
      if (side === 1 && bar.low <= entry - stopDistance) exit = entry - stopDistance;
      else if (side === -1 && bar.high >= entry + stopDistance) exit = entry + stopDistance;
      else if (side === 1 && bar.high >= entry + targetDistance) exit = entry + targetDistance;
      else if (side === -1 && bar.low <= entry - targetDistance) exit = entry - targetDistance;
      else if (request.trailingStopPips) {
        const trail = request.trailingStopPips * pipSize;
        exit = side === 1 ? Math.max(exit, bar.high - trail) : Math.min(exit, bar.low + trail);
      }

      const gross = (exit - entry) * side * lots * lotSize;
      const pnl = gross - request.commissionPerTrade;
      const rMultiple = riskBudget > 0 ? pnl / riskBudget : 0;
      equity += pnl;
      trades.push({ entry: round(entry), exit: round(exit), pnl: round(pnl), rMultiple: round(rMultiple), outcome: pnl >= 0 ? "win" : "loss" });
    }
    return trades;
  }
}

function calculateMetrics(initialCapital: number, trades: Trade[]) {
  const returns = trades.map((trade) => trade.pnl / initialCapital);
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const net = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  let equity = initialCapital;
  let peak = equity;
  let maxDrawdownPct = 0;
  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - equity) / peak * 100 : 100);
  }
  const average = mean(returns);
  const downside = returns.filter((value) => value < 0);
  const deviation = standardDeviation(returns);
  const downsideDeviation = standardDeviation(downside);
  return {
    netReturnPct: round(net / initialCapital * 100),
    maxDrawdownPct: round(maxDrawdownPct),
    winRatePct: round(trades.length ? wins.length / trades.length * 100 : 0),
    expectancy: round(trades.length ? net / trades.length : 0),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0),
    sharpe: round(deviation > 0 ? average / deviation * Math.sqrt(252) : 0),
    sortino: round(downsideDeviation > 0 ? average / downsideDeviation * Math.sqrt(252) : 0),
    averageRMultiple: round(mean(trades.map((trade) => trade.rMultiple))),
    worstTrade: round(Math.min(0, ...trades.map((trade) => trade.pnl))),
    bestTrade: round(Math.max(0, ...trades.map((trade) => trade.pnl))),
    endingEquity: round(initialCapital + net),
  };
}

function monteCarloRiskOfRuin(pnls: number[], initialCapital: number, runs: number) {
  if (runs === 0 || pnls.length === 0) return { riskOfRuinPct: 0, worstEndingEquity: initialCapital };
  let ruined = 0;
  let worst = initialCapital;
  for (let run = 0; run < runs; run += 1) {
    let equity = initialCapital;
    let runRuined = false;
    for (let index = 0; index < pnls.length; index += 1) {
      const deterministicIndex = (run * 17 + index * 31) % pnls.length;
      equity += pnls[deterministicIndex];
      if (equity <= initialCapital * 0.5) runRuined = true;
    }
    if (runRuined) ruined += 1;
    worst = Math.min(worst, equity);
  }
  return { riskOfRuinPct: round(ruined / runs * 100), worstEndingEquity: round(worst) };
}

function pipValue(pipSize: number, lotSize: number) {
  return pipSize * lotSize;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

export const marketBacktestingService = new MarketBacktestingService();
