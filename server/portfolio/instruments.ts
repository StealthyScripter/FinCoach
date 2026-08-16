import type { AssetClass, PortfolioInstrument } from "./domain";

export function canonicalInstrument(symbol: string, input: Partial<PortfolioInstrument> = {}): PortfolioInstrument {
  const normalized = symbol.toUpperCase();
  return {
    instrumentId: input.instrumentId ?? `portfolio:${normalized}`,
    symbol: normalized,
    displayName: input.displayName ?? normalized,
    assetClass: input.assetClass ?? inferAssetClass(normalized),
    subtype: input.subtype ?? null,
    exchange: input.exchange ?? "NYSE_ARCA",
    currency: "USD",
    country: input.country ?? "United States",
    sector: input.sector ?? null,
    industry: input.industry ?? null,
    marketCalendar: input.marketCalendar ?? "US_EQUITY",
    tickSize: input.tickSize ?? 0.01,
    lotSize: input.lotSize ?? 0.000001,
    contractMultiplier: input.contractMultiplier ?? null,
    underlying: input.underlying ?? null,
    optionStrike: input.optionStrike ?? null,
    optionExpiration: input.optionExpiration ?? null,
    optionType: input.optionType ?? null,
    bondMaturity: input.bondMaturity ?? null,
    coupon: input.coupon ?? null,
    providerMappings: input.providerMappings ?? { alpha_vantage: normalized },
    benchmarkEligible: input.benchmarkEligible ?? ["equity", "etf", "index_proxy"].includes(input.assetClass ?? inferAssetClass(normalized)),
    status: input.status ?? "active",
  };
}

export function inferAssetClass(symbol: string): AssetClass {
  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol)) return "option";
  return "etf";
}

export function optionInstrument(input: { symbol: string; underlying: string; strike: number; expiration: string; optionType: "call" | "put"; priceProvider?: string }): PortfolioInstrument {
  return canonicalInstrument(input.symbol, {
    assetClass: "option",
    displayName: `${input.underlying} ${input.expiration} ${input.strike} ${input.optionType.toUpperCase()}`,
    exchange: "OPRA",
    marketCalendar: "US_OPTIONS",
    lotSize: 1,
    contractMultiplier: 100,
    underlying: input.underlying.toUpperCase(),
    optionStrike: input.strike,
    optionExpiration: input.expiration,
    optionType: input.optionType,
    providerMappings: input.priceProvider ? { [input.priceProvider]: input.symbol } : {},
    benchmarkEligible: false,
  });
}
