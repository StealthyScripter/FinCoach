import type { BacktestResult } from "../backtesting";
export const courtroomPolicyVersion = "courtroom.policy.v1";
export function judge(backtests: BacktestResult[], counts: { defense: number; prosecution: number; risk: number }) {
  const reasons: string[] = []; if (!counts.defense) reasons.push("missing defense"); if (!counts.prosecution) reasons.push("missing prosecution"); if (!counts.risk) reasons.push("missing risk review");
  const bt = backtests[0]; if (!bt || bt.status !== "completed") reasons.push("missing completed backtest"); else { if (bt.aggregateMetrics.tradeCount < 3) reasons.push("weak sample"); if (bt.aggregateMetrics.expectancy <= 0) reasons.push("nonpositive expectancy"); if (bt.aggregateMetrics.maxDrawdown > 5) reasons.push("excessive drawdown"); if (bt.warnings.length) reasons.push("backtest warnings unresolved"); }
  return { verdict: reasons.length ? "reject" as const : "approve_for_replay" as const, reasons };
}
