import { createHash } from "node:crypto";
import type { ExternalEvaluationInput } from "../external-evaluation";
import type { NormalizedCandle } from "../market-data";
import type { V2ResearchSignal } from "../signals";

export type FrozenSignalEvaluation = {
  evaluation: ExternalEvaluationInput | null;
  reason: "evaluated" | "horizon_incomplete" | "missing_market_data" | "ambiguous_same_candle";
  evidenceHash: string | null;
};

export function evaluateSignalFromFrozenCandles(signal: V2ResearchSignal, candles: readonly NormalizedCandle[], at: Date): FrozenSignalEvaluation {
  if (at.getTime() < Date.parse(signal.validUntil)) return { evaluation: null, reason: "horizon_incomplete", evidenceHash: null };
  const frozen = candles
    .filter(candle => candle.complete && candle.symbol === signal.symbol && candle.timeframe === signal.timeframe && Date.parse(candle.timestamp) >= Date.parse(signal.createdAt) && Date.parse(candle.timestamp) < Date.parse(signal.validUntil))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (!frozen.length) return { evaluation: null, reason: "missing_market_data", evidenceHash: null };

  const evidenceHash = hashFrozenCandles(frozen);
  const risk = Math.abs(signal.entryPrice - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit - signal.entryPrice);
  let entryReached = false;
  let mfe = 0;
  let mae = 0;
  for (const candle of frozen) {
    const range = executableRange(signal, candle);
    if (!entryReached) {
      entryReached = range.low <= signal.entryPrice && range.high >= signal.entryPrice;
      if (!entryReached) continue;
    }
    const tpReached = signal.side === "buy" ? range.high >= signal.takeProfit : range.low <= signal.takeProfit;
    const slReached = signal.side === "buy" ? range.low <= signal.stopLoss : range.high >= signal.stopLoss;
    if (tpReached && slReached) return { evaluation: null, reason: "ambiguous_same_candle", evidenceHash };
    const favorable = signal.side === "buy" ? range.high - signal.entryPrice : signal.entryPrice - range.low;
    const adverse = signal.side === "buy" ? signal.entryPrice - range.low : range.high - signal.entryPrice;
    mfe = Math.max(mfe, favorable / risk);
    mae = Math.max(mae, adverse / risk);
    if (tpReached || slReached) {
      const outcome = tpReached ? "tp" as const : "sl" as const;
      const r = tpReached ? roundR(reward / risk) : -1;
      return { evaluation: buildEvaluation(signal, at, evidenceHash, frozen, { entryReached, tpReached, slReached, outcome, r, mfe: roundR(mfe), mae: roundR(mae) }), reason: "evaluated", evidenceHash };
    }
  }
  return { evaluation: buildEvaluation(signal, at, evidenceHash, frozen, { entryReached, tpReached: false, slReached: false, outcome: "expired", r: 0, mfe, mae }), reason: "evaluated", evidenceHash };
}

function roundR(value: number) {
  return Number(value.toFixed(6));
}

function executableRange(signal: V2ResearchSignal, candle: NormalizedCandle) {
  const component = signal.side === "buy" ? candle.ask : candle.bid;
  return component ? { low: component.low, high: component.high } : { low: candle.low, high: candle.high };
}

function buildEvaluation(signal: V2ResearchSignal, at: Date, evidenceHash: string, candles: readonly NormalizedCandle[], outcome: { entryReached: boolean; tpReached: boolean; slReached: boolean; outcome: "tp" | "sl" | "expired"; r: number; mfe: number; mae: number }): ExternalEvaluationInput {
  const evaluationId = createHash("sha256").update(JSON.stringify({ signalId: signal.signalId, evidenceHash, evaluator: "fincoach-frozen-candle-evaluator-v1" })).digest("hex");
  return {
    evaluationId,
    signalId: signal.signalId,
    strategyId: signal.strategyId,
    forwardTestId: signal.forwardTestId,
    evaluatorVersion: "fincoach-frozen-candle-evaluator-v1",
    ...outcome,
    profitLoss: outcome.r,
    holdingDurationMinutes: Math.max(0, (Math.min(at.getTime(), Date.parse(signal.validUntil)) - Date.parse(signal.createdAt)) / 60_000),
    dataSource: candles[0]!.source.provider,
    evaluatedAt: at.toISOString(),
    evidenceHash,
    notes: `Frozen post-signal candles=${candles.length}; same-candle TP/SL ambiguity fails closed.`,
    lineageEventIds: [...new Set([...signal.lineageEventIds, signal.strategyId, signal.forwardTestId, signal.signalId, evidenceHash])],
    correlationId: signal.correlationId,
    causationId: signal.causationId,
  };
}

function hashFrozenCandles(candles: readonly NormalizedCandle[]) {
  return createHash("sha256").update(JSON.stringify(candles.map(candle => ({ symbol: candle.symbol, timeframe: candle.timeframe, timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, bid: candle.bid, ask: candle.ask, complete: candle.complete, source: candle.source })))).digest("hex");
}
