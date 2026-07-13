import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { BacktestInput, BacktestResult, BacktestTrade } from "./contracts";
import { BacktestingV2EventTypes } from "./events";
import { computeMetrics } from "./metrics";

export class BacktestingV2Engine {
  run(input: BacktestInput): { result: BacktestResult; events: DomainEvent[] } {
    try { validate(input); } catch (error) {
      const result = failed(input, error instanceof Error ? error.message : "unknown");
      return { result, events: [createDomainEvent({ eventType: BacktestingV2EventTypes.BacktestInvalidated, sourceModule: "backtesting", correlationId: input.correlationId, causationId: input.causationId, payload: { reason: result.warnings[0] } })] };
    }
    const trades = simulate(input); const metrics = computeMetrics(trades, input.candles.length);
    const result: BacktestResult = { backtestId: id(input), experimentId: input.experimentId, strategyId: input.strategy.strategyId, strategyVersion: input.strategy.strategyVersion, datasetFingerprint: dataset(input), engineVersion: "backtesting.v1", costModelVersion: input.strategy.costModel.version, fillModelVersion: "deterministic-ohlc.v1", randomSeed: input.randomSeed, partitions: [{ name: "all", metrics }], aggregateMetrics: metrics, trades, warnings: trades.length ? [] : ["zero trades"], lineageEventIds: input.lineageEventIds, status: "completed", createdAt: new Date().toISOString(), correlationId: input.correlationId, causationId: input.causationId };
    return { result, events: [createDomainEvent({ eventType: BacktestingV2EventTypes.BacktestStarted, sourceModule: "backtesting", correlationId: input.correlationId, causationId: input.causationId, payload: { experimentId: input.experimentId } }), createDomainEvent({ eventType: BacktestingV2EventTypes.CostModelApplied, sourceModule: "backtesting", correlationId: input.correlationId, causationId: input.causationId, payload: { spread: input.spread, commission: input.commissionPerTrade } }), createDomainEvent({ eventType: BacktestingV2EventTypes.BacktestCompleted, sourceModule: "backtesting", correlationId: input.correlationId, causationId: input.causationId, payload: { backtestId: result.backtestId, tradeCount: trades.length } })] };
  }
}
function simulate(input: BacktestInput): BacktestTrade[] { const trades: BacktestTrade[]=[]; for(let i=1;i<input.candles.length-1;i+=5){const c=input.candles[i], n=input.candles[i+1]; const cost=input.spread+input.slippage+input.commissionPerTrade; const r=Number(((n.close-c.close)-cost).toFixed(6)); trades.push({tradeId:`t-${i}`, entryAt:c.timestamp, exitAt:n.timestamp, side:"buy", entry:c.close+input.spread/2, exit:n.close-input.spread/2, r, cost, mfe:n.high-c.close, mae:c.close-n.low});} return trades; }
function validate(input: BacktestInput){ for(let i=1;i<input.candles.length;i++) if(input.candles[i].timestamp<=input.candles[i-1].timestamp) throw new Error("look-ahead or unordered candles"); if(!input.strategy.stopLoss||!input.strategy.takeProfit) throw new Error("missing exits"); if(!input.lineageEventIds.length) throw new Error("missing lineage"); if(input.spread<0||input.commissionPerTrade<0||input.slippage<0) throw new Error("invalid cost model");}
function id(i:BacktestInput){return createHash("sha256").update(JSON.stringify({e:i.experimentId,s:i.strategy.strategyId,d:dataset(i),seed:i.randomSeed,c:i.spread})).digest("hex").slice(0,32)} function dataset(i:BacktestInput){return createHash("sha256").update(JSON.stringify(i.candles.map(c=>[c.symbol,c.timeframe,c.timestamp,c.close]))).digest("hex")}
function failed(input:BacktestInput, reason:string):BacktestResult{return {backtestId:id(input),experimentId:input.experimentId,strategyId:input.strategy.strategyId,strategyVersion:input.strategy.strategyVersion,datasetFingerprint:dataset(input),engineVersion:"backtesting.v1",costModelVersion:input.strategy.costModel.version,fillModelVersion:"deterministic-ohlc.v1",randomSeed:input.randomSeed,partitions:[],aggregateMetrics:computeMetrics([],input.candles.length),trades:[],warnings:[reason],lineageEventIds:input.lineageEventIds,status:"invalid",createdAt:new Date().toISOString(),correlationId:input.correlationId,causationId:input.causationId}}
export const backtestingV2Engine = new BacktestingV2Engine();
