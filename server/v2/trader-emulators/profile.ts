import { createHash } from "crypto";
import type { TraderAnalysisInput, TraderAnalysisPackage, TraderProfile } from "./contracts";

export const profilePolicies: Record<TraderProfile, { horizon: string; timeframes: string[]; maxAgeMinutes: number }> = {
  scalper: { horizon: "minutes", timeframes: ["1m", "5m"], maxAgeMinutes: 15 },
  day_trader: { horizon: "intraday", timeframes: ["5m", "15m", "30m", "1h"], maxAgeMinutes: 240 },
  swing_trader: { horizon: "multi-day", timeframes: ["1h", "4h", "1d"], maxAgeMinutes: 4320 },
  position_trader: { horizon: "long-term", timeframes: ["1d", "1w", "1mo"], maxAgeMinutes: 43200 },
};

export function analyzeWithPolicy(input: TraderAnalysisInput): TraderAnalysisPackage {
  const policy = profilePolicies[input.profile];
  if (!policy.timeframes.includes(input.timeframe)) throw new Error(`${input.profile} does not support timeframe ${input.timeframe}`);
  const now = Date.parse(input.analyzedAt);
  const expired = input.evidence.filter((item) => Date.parse(item.expiresAt) < now);
  const risks = [
    input.context.spreadState === "wide" ? { riskId: "wide_spread", severity: "high" as const, description: "Spread is excessive for profile" } : null,
    input.context.liquidityState === "thin" || input.context.liquidityState === "closed" ? { riskId: "low_liquidity", severity: "high" as const, description: "Liquidity is insufficient" } : null,
    input.context.eventProximity === "blackout" ? { riskId: "event_blackout", severity: "high" as const, description: "Major event proximity" } : null,
    expired.length ? { riskId: "expired_evidence", severity: "medium" as const, description: "Some evidence expired" } : null,
  ].filter((risk): risk is NonNullable<typeof risk> => Boolean(risk));
  const support = input.evidence.filter((item) => Date.parse(item.expiresAt) >= now);
  const contradictions = input.contradictoryEvidence ?? [];
  const confidence = Number(Math.max(0, Math.min(1, support.reduce((sum, item) => sum + item.weight, 0) / Math.max(1, support.length) - risks.length * 0.2 - contradictions.length * 0.2)).toFixed(4));
  const opportunityState = risks.some((risk) => risk.severity === "high") || confidence < 0.35 ? "none" : confidence > 0.7 ? "candidate" : "monitor";
  return {
    analysisId: createHash("sha256").update(JSON.stringify({ p: input.profile, s: input.symbol, t: input.analyzedAt, e: input.evidence })).digest("hex").slice(0, 32),
    schemaVersion: "fincoach.v2.trader-analysis.1",
    profile: input.profile,
    symbol: input.symbol,
    analyzedAt: input.analyzedAt,
    horizon: policy.horizon,
    supportedTimeframes: [...policy.timeframes],
    observations: [...input.observations],
    supportingEvidence: support,
    contradictoryEvidence: contradictions,
    risks,
    opportunityState,
    confidence,
    invalidationConditions: ["Evidence expires", "Context changes", "Contradictory observation appears"],
    requiredAdditionalEvidence: opportunityState === "candidate" ? [] : ["Fresh confirming observation"],
    correlationId: input.correlationId,
    causationId: input.causationId,
  };
}
