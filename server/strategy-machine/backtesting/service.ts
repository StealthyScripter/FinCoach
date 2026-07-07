import { createEvent } from "../core";
import type { Candle } from "../market-data";
import { BacktestingEventTypes } from "./events";
import type { BacktestInput, BacktestResult, BacktestTrade } from "./contracts";
import { BacktestRepository } from "./repository";

const MIN_BACKTEST_CANDLES = 20;

export class BacktestService {
  constructor(private readonly repository = new BacktestRepository()) {}

  run(input: BacktestInput) {
    const started = createEvent({ type: BacktestingEventTypes.BacktestStarted, module: "backtesting", payload: { experimentId: input.experimentId, ruleSetId: input.ruleSet.ruleSetId }, sourceEventRefs: input.sourceEventRefs });
    if (input.candles.length < MIN_BACKTEST_CANDLES) {
      return createEvent({ type: BacktestingEventTypes.BacktestInsufficientSample, module: "backtesting", payload: { required: MIN_BACKTEST_CANDLES, actual: input.candles.length }, causationId: started.id, sourceEventRefs: input.sourceEventRefs });
    }
    try {
      const result = computeBacktest(input);
      this.repository.save(result);
      return createEvent({ type: BacktestingEventTypes.BacktestCompleted, module: "backtesting", payload: result as unknown as Record<string, unknown>, causationId: started.id, sourceEventRefs: input.sourceEventRefs });
    } catch (error) {
      return createEvent({ type: BacktestingEventTypes.BacktestFailed, module: "backtesting", payload: { message: error instanceof Error ? error.message : "Backtest failed" }, causationId: started.id, sourceEventRefs: input.sourceEventRefs });
    }
  }
}

function computeBacktest(input: BacktestInput): BacktestResult {
  const trades: BacktestTrade[] = [];
  for (let index = 2; index < input.candles.length - 3; index += 4) {
    const entryCandle = input.candles[index];
    const future = input.candles[index + 3];
    const entry = entryCandle.close + input.spread + input.slippage;
    const stopDistance = Math.max(entryCandle.high - entryCandle.low, entry * 0.001);
    const stop = entry - stopDistance;
    const target = entry + stopDistance * 1.5;
    const rawExit = future.close - input.slippage - input.commissionPerTrade;
    const exit = rawExit <= stop ? stop : rawExit >= target ? target : rawExit;
    const rMultiple = round((exit - entry) / (entry - stop));
    trades.push({
      entryAt: entryCandle.timestamp,
      exitAt: future.timestamp,
      instrument: entryCandle.instrument,
      direction: "long",
      entry: round(entry),
      exit: round(exit),
      stop: round(stop),
      target: round(target),
      rMultiple,
      outcome: rMultiple > 0.1 ? "win" : rMultiple < -0.1 ? "loss" : "flat",
      session: sessionFor(entryCandle.timestamp),
      regime: rMultiple >= 0 ? "supportive" : "adverse",
    });
  }
  const wins = trades.filter((trade) => trade.outcome === "win");
  const losses = trades.filter((trade) => trade.outcome === "loss");
  const grossWin = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  return {
    experimentId: input.experimentId,
    ruleSetId: input.ruleSet.ruleSetId,
    tradeCount: trades.length,
    winRate: round(wins.length / trades.length),
    lossRate: round(losses.length / trades.length),
    expectancy: round(avg(trades.map((trade) => trade.rMultiple))),
    profitFactor: grossLoss === 0 ? grossWin : round(grossWin / grossLoss),
    maxDrawdown: round(maxDrawdown(trades.map((trade) => trade.rMultiple))),
    averageWinner: round(avg(wins.map((trade) => trade.rMultiple))),
    averageLoser: round(avg(losses.map((trade) => trade.rMultiple))),
    averageR: round(avg(trades.map((trade) => trade.rMultiple))),
    bestTrade: trades.reduce((best, trade) => (!best || trade.rMultiple > best.rMultiple ? trade : best), null as BacktestTrade | null),
    worstTrade: trades.reduce((worst, trade) => (!worst || trade.rMultiple < worst.rMultiple ? trade : worst), null as BacktestTrade | null),
    regimeBreakdown: countBy(trades.map((trade) => trade.regime)),
    symbolBreakdown: countBy(trades.map((trade) => trade.instrument)),
    timeframeBreakdown: countBy(input.candles.map((candle) => candle.timeframe)),
    sessionBreakdown: countBy(trades.map((trade) => trade.session)),
    trades,
  };
}

function maxDrawdown(values: number[]) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity - peak);
  }
  return Math.abs(drawdown);
}

function sessionFor(timestamp: string) {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour < 12 ? "london" : hour >= 12 && hour < 16 ? "overlap" : hour >= 16 && hour < 21 ? "new_york" : hour >= 0 && hour < 7 ? "asia" : "off_hours";
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

function avg(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const backtestService = new BacktestService();
