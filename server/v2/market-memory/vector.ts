import { createHash } from "crypto";
import type { MarketStateFeatureValue, MarketStateVector, VectorInput } from "./contracts";

const FUTURE_KEYS = [/future/i, /outcome/i, /label/i, /realizedReturn/i, /pnl/i];
export function assertNoFutureOutcomeFields(features: Record<string, MarketStateFeatureValue>) {
  for (const key of Object.keys(features)) if (FUTURE_KEYS.some((rx) => rx.test(key))) throw new Error(`future outcome field prohibited: ${key}`);
}
export function canonicalFeatures(features: Record<string, MarketStateFeatureValue>) {
  return Object.fromEntries(Object.entries(features).sort(([a], [b]) => a.localeCompare(b)));
}
export function vectorFingerprint(input: Pick<MarketStateVector, "symbol" | "timeframe" | "effectiveAt" | "features" | "sourceEventIds">) {
  return JSON.stringify({ symbol: input.symbol, timeframe: input.timeframe, effectiveAt: input.effectiveAt, features: canonicalFeatures(input.features), sourceEventIds: [...input.sourceEventIds].sort() });
}
export function createMarketStateVector(input: VectorInput): MarketStateVector {
  if (!input.sourceEventIds.length) throw new Error("lineage required");
  assertNoFutureOutcomeFields(input.features);
  const base = { ...input, features: canonicalFeatures(input.features), vectorVersion: "fincoach.v2.market-memory.vector.1" as const, createdAt: input.createdAt ?? input.effectiveAt };
  return { ...base, stateId: createHash("sha256").update(vectorFingerprint(base)).digest("hex").slice(0, 32) };
}
