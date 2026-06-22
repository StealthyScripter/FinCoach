import { INSTRUMENTS, normalizeSymbol } from "./domain";
import { SandboxBrokerError } from "./brokerFailures";
import type { BrokerInstrument, SandboxProviderId } from "./brokerSandbox";

export type SymbolMapping = BrokerInstrument & {
  marginEstimate(notionalValue: number): number;
};

const SIZE_LIMITS: Record<string, { min: number; max: number }> = {
  "EUR/USD": { min: 1, max: 10_000_000 },
  "GBP/USD": { min: 1, max: 10_000_000 },
  "USD/JPY": { min: 1, max: 10_000_000 },
  "XAU/USD": { min: 1, max: 100_000 },
  "XAG/USD": { min: 1, max: 1_000_000 },
  WTI: { min: 1, max: 100_000 },
  Brent: { min: 1, max: 100_000 },
};

export function getSymbolMapping(symbol: string, provider: SandboxProviderId): SymbolMapping {
  const instrument = normalizeSymbol(symbol);
  if (!instrument) throw new SandboxBrokerError("invalid_instrument");
  const providerKey = provider === "oanda_practice" ? "oanda" : "metatrader5";
  const providerSymbol = instrument.providerMappings[providerKey];
  if (!providerSymbol) throw new SandboxBrokerError("invalid_instrument");
  const limits = SIZE_LIMITS[instrument.symbol];
  return {
    internalSymbol: instrument.symbol,
    providerSymbol,
    displayName: instrument.symbol,
    pipSize: instrument.pipSize,
    tickSize: instrument.tickSize,
    tradeUnits: provider === "metatrader_demo" ? "lots" : "units",
    minSize: limits.min,
    maxSize: limits.max,
    marginRate: instrument.marginRequirement,
    marketHours: instrument.sessionHours,
    marginEstimate: (notionalValue) => round(notionalValue * instrument.marginRequirement),
  };
}

export function listSymbolMappings(provider: SandboxProviderId): SymbolMapping[] {
  return INSTRUMENTS.map((instrument) => getSymbolMapping(instrument.symbol, provider));
}

function round(value: number) {
  return Number(value.toFixed(2));
}
