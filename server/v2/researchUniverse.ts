import { INSTRUMENTS, normalizeSymbol } from "../execution/domain";

export type ResearchInstrumentAssetClass = "forex" | "commodity";
export type ResearchInstrumentSessionGroup = "FX Global" | "Provider Metals and Energy";
export type ResearchInstrumentValidationState = "validated" | "unsupported";

export type ResearchInstrumentRecord = {
  symbol: string;
  displaySymbol: string;
  provider: "oanda";
  providerSymbol: string;
  assetClass: ResearchInstrumentAssetClass;
  venue: ResearchInstrumentSessionGroup;
  sessionGroup: "fx" | "commodities";
  providerSupport: "configured_mapping";
  marketCalendarSupport: "partial";
  v2MarketDataSupport: "deterministic_demo_and_oanda_historical";
  detectorSupport: "ohlc_detectors";
  historicalDataSupport: "oanda_historical_candles";
  safeForResearch: true;
};

export type ResearchInstrumentValidation = {
  requested: string[];
  configured: number;
  validated: ResearchInstrumentRecord[];
  unsupported: Array<{ symbol: string; reason: string }>;
  counts: {
    configured: number;
    validated: number;
    unsupported: number;
    byAssetClass: Record<string, number>;
    bySession: Record<string, number>;
    byProvider: Record<string, number>;
  };
  providerValidation: {
    provider: "oanda";
    status: "configured_mapping" | "unavailable";
    reason: string;
  };
  marketCalendarValidation: {
    status: "partial" | "unavailable";
    reason: string;
  };
};

export const RESEARCH_INSTRUMENT_UNIVERSE: ResearchInstrumentRecord[] = INSTRUMENTS
  .filter((instrument) => Boolean(instrument.providerMappings.oanda))
  .map((instrument) => ({
    symbol: instrument.providerMappings.oanda,
    displaySymbol: instrument.symbol,
    provider: "oanda" as const,
    providerSymbol: instrument.providerMappings.oanda,
    assetClass: instrument.assetClass,
    venue: instrument.assetClass === "forex" ? "FX Global" as const : "Provider Metals and Energy" as const,
    sessionGroup: instrument.assetClass === "forex" ? "fx" as const : "commodities" as const,
    providerSupport: "configured_mapping" as const,
    marketCalendarSupport: "partial" as const,
    v2MarketDataSupport: "deterministic_demo_and_oanda_historical" as const,
    detectorSupport: "ohlc_detectors" as const,
    historicalDataSupport: "oanda_historical_candles" as const,
    safeForResearch: true as const,
  }));

export const DEFAULT_RESEARCH_SYMBOLS = RESEARCH_INSTRUMENT_UNIVERSE.map((instrument) => instrument.symbol);

export function normalizeResearchSymbol(value: string) {
  const known = normalizeSymbol(value);
  return known?.providerMappings.oanda ?? value.trim().toUpperCase().replace(/[/-]/g, "_");
}

export function resolveResearchInstrument(symbol: string): ResearchInstrumentRecord | null {
  const normalized = normalizeResearchSymbol(symbol);
  return RESEARCH_INSTRUMENT_UNIVERSE.find((instrument) => instrument.symbol === normalized) ?? null;
}

export function parseResearchSymbols(value: string | undefined, fallback = DEFAULT_RESEARCH_SYMBOLS) {
  const source = value?.trim() ? value : fallback.join(",");
  return [...new Set(source.split(",").map(normalizeResearchSymbol).filter(Boolean))];
}

export function validateResearchUniverse(symbols: string[]): ResearchInstrumentValidation {
  const requested = [...new Set(symbols.map(normalizeResearchSymbol))];
  const validated: ResearchInstrumentRecord[] = [];
  const unsupported: ResearchInstrumentValidation["unsupported"] = [];
  for (const symbol of requested) {
    const instrument = resolveResearchInstrument(symbol);
    if (instrument) validated.push(instrument);
    else unsupported.push({ symbol, reason: "No canonical research instrument, provider mapping, or market-session metadata exists; failing closed." });
  }
  return {
    requested,
    configured: requested.length,
    validated,
    unsupported,
    counts: {
      configured: requested.length,
      validated: validated.length,
      unsupported: unsupported.length,
      byAssetClass: countBy(validated, item => item.assetClass),
      bySession: countBy(validated, item => item.venue),
      byProvider: countBy(validated, item => item.provider),
    },
    providerValidation: {
      provider: "oanda",
      status: validated.length ? "configured_mapping" : "unavailable",
      reason: validated.length
        ? "Validated against the checked-in execution-domain OANDA provider mappings. Live provider discovery is not performed at runtime."
        : "No configured symbols matched an OANDA-mapped research instrument.",
    },
    marketCalendarValidation: {
      status: validated.length ? "partial" : "unavailable",
      reason: validated.length
        ? "Calendar support uses built-in FX/commodity session rules with DST-aware America/New_York boundaries, not an exchange holiday feed."
        : "No validated symbol has market-calendar support.",
    },
  };
}

function countBy<T>(items: T[], keyOf: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
  return counts;
}
