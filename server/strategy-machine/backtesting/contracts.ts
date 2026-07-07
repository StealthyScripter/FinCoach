import type { EventReference } from "../core";
import type { Candle } from "../market-data";
import type { RuleSet } from "../rule-builder";

export type BacktestTrade = {
  entryAt: string;
  exitAt: string;
  instrument: string;
  direction: "long" | "short";
  entry: number;
  exit: number;
  stop: number;
  target: number;
  rMultiple: number;
  outcome: "win" | "loss" | "flat";
  session: string;
  regime: string;
};

export type BacktestInput = {
  experimentId: string;
  ruleSet: RuleSet;
  candles: Candle[];
  spread: number;
  slippage: number;
  commissionPerTrade: number;
  riskPerTrade: number;
  sourceEventRefs: EventReference[];
};

export type BacktestResult = {
  experimentId: string;
  ruleSetId: string;
  tradeCount: number;
  winRate: number;
  lossRate: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  averageWinner: number;
  averageLoser: number;
  averageR: number;
  bestTrade: BacktestTrade | null;
  worstTrade: BacktestTrade | null;
  regimeBreakdown: Record<string, number>;
  symbolBreakdown: Record<string, number>;
  timeframeBreakdown: Record<string, number>;
  sessionBreakdown: Record<string, number>;
  trades: BacktestTrade[];
};
