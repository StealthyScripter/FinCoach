import type { PortfolioOptionContract, PortfolioQuote } from "./domain";

export function optionMarketValue(contract: PortfolioOptionContract, quantity: number) {
  const price = contract.last ?? midpoint(contract);
  if (price === null) throw new Error("option_observed_price_unavailable");
  return round(price * contract.multiplier * quantity);
}

export function settleExpiredOption(input: { contract: PortfolioOptionContract; quantity: number; underlyingQuote: PortfolioQuote | null }) {
  if (input.contract.lifecycle !== "EXPIRED") return { ok: false as const, reason: "option_not_expired" };
  if (!input.underlyingQuote) return { ok: false as const, reason: "underlying_settlement_price_unavailable" };
  const intrinsic = input.contract.optionType === "call"
    ? Math.max(0, input.underlyingQuote.last - input.contract.strike)
    : Math.max(0, input.contract.strike - input.underlyingQuote.last);
  return { ok: true as const, cashSettlement: round(intrinsic * input.contract.multiplier * input.quantity), intrinsicValue: round(intrinsic), observedUnderlying: input.underlyingQuote.last, source: input.underlyingQuote.source };
}

function midpoint(contract: PortfolioOptionContract) {
  if (contract.bid !== null && contract.ask !== null) return (contract.bid + contract.ask) / 2;
  return null;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
