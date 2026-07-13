import type { BacktestMetrics, BacktestTrade } from "./contracts";
export function computeMetrics(trades: BacktestTrade[], sampleDepth: number): BacktestMetrics {
  const rs = trades.map(t => t.r); const wins = rs.filter(r=>r>0); const losses = rs.filter(r=>r<0);
  const grossProfit = sum(wins), grossLoss = Math.abs(sum(losses)); const netProfit = sum(rs);
  const metrics = { netProfit, grossProfit, grossLoss, profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit/grossLoss), expectancy: round(netProfit / Math.max(1, trades.length)), averageR: round(netProfit / Math.max(1, trades.length)), medianR: median(rs), winRate: round(wins.length/Math.max(1,trades.length)), lossRate: round(losses.length/Math.max(1,trades.length)), maxDrawdown: drawdown(rs), tradeCount: trades.length, sampleDepth, costSensitivity: round(sum(trades.map(t=>t.cost))), stability: trades.length < 2 ? 0 : round(1/(1+Math.abs(drawdown(rs)))) };
  if (Object.values(metrics).some(v => typeof v === "number" && !Number.isFinite(v))) throw new Error("invalid metric");
  return metrics;
}
function sum(v:number[]){return v.reduce((a,b)=>a+b,0)} function round(v:number){return Number(v.toFixed(6))} function median(v:number[]){if(!v.length)return 0; const s=[...v].sort((a,b)=>a-b); return round(s[Math.floor(s.length/2)])} function drawdown(rs:number[]){let peak=0,equity=0,dd=0; for(const r of rs){equity+=r; peak=Math.max(peak,equity); dd=Math.min(dd,equity-peak)} return round(Math.abs(dd))}
