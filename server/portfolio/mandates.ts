import type { PortfolioStrategy } from "./domain";

export type RiskMandatePolicy = {
  riskLevel: number;
  maxVolatilityPct: number;
  maxDrawdownPct: number;
  maxSinglePositionPct: number;
  maxAssetClassPct: number;
  cashFloorPct: number;
  minPositions: number;
  turnoverTolerancePct: number;
  optionsPolicy: "forbidden" | "hedging_only" | "allowed";
  leverageAllowed: false;
};

export function mandatePolicy(strategy: Pick<PortfolioStrategy, "riskLevel" | "mandate">): RiskMandatePolicy {
  const risk = strategy.riskLevel;
  return {
    riskLevel: risk,
    maxVolatilityPct: [0, 2, 4, 6, 8, 11, 15, 19, 25, 35, 50][risk] ?? 50,
    maxDrawdownPct: [0, 2, 4, 7, 10, 14, 18, 24, 32, 45, 60][risk] ?? 60,
    maxSinglePositionPct: Math.max(5, 30 - risk),
    maxAssetClassPct: risk <= 3 ? 70 : risk <= 6 ? 85 : 100,
    cashFloorPct: Math.max(0, 20 - risk * 1.5),
    minPositions: risk <= 3 ? 4 : risk <= 7 ? 5 : 3,
    turnoverTolerancePct: risk <= 3 ? 20 : risk <= 7 ? 60 : 120,
    optionsPolicy: risk <= 5 ? "forbidden" : risk <= 8 ? "hedging_only" : "allowed",
    leverageAllowed: false,
  };
}

export function validateMandate(input: { strategy: Pick<PortfolioStrategy, "riskLevel" | "mandate">; singlePositionPct: number; assetClassPct: number; cashPct: number; positions: number; volatilityPct?: number | null; drawdownPct?: number | null }) {
  const policy = mandatePolicy(input.strategy);
  const breaches = [];
  if (input.singlePositionPct > policy.maxSinglePositionPct) breaches.push({ code: "max_single_position", observed: input.singlePositionPct, limit: policy.maxSinglePositionPct });
  if (input.assetClassPct > policy.maxAssetClassPct) breaches.push({ code: "max_asset_class", observed: input.assetClassPct, limit: policy.maxAssetClassPct });
  if (input.cashPct < policy.cashFloorPct) breaches.push({ code: "cash_floor", observed: input.cashPct, limit: policy.cashFloorPct });
  if (input.positions < policy.minPositions) breaches.push({ code: "minimum_diversification", observed: input.positions, limit: policy.minPositions });
  if (input.volatilityPct !== null && input.volatilityPct !== undefined && input.volatilityPct > policy.maxVolatilityPct) breaches.push({ code: "max_volatility", observed: input.volatilityPct, limit: policy.maxVolatilityPct });
  if (input.drawdownPct !== null && input.drawdownPct !== undefined && input.drawdownPct > policy.maxDrawdownPct) breaches.push({ code: "max_drawdown", observed: input.drawdownPct, limit: policy.maxDrawdownPct });
  return { ok: breaches.length === 0, policy, breaches };
}
