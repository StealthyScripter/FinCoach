export type QuoteSnapshot = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volumeTrend: "rising" | "flat" | "falling";
  timestamp: string;
};

export type MacroSnapshot = {
  policyRateBias: "easing" | "neutral" | "tightening";
  twoYearYieldChangeBps: number;
  dollarChangePct: number;
  inflationSurprise: "hotter" | "inline" | "cooler";
  recessionRisk: "low" | "moderate" | "high";
  timestamp: string;
};

export type NewsSnapshot = {
  headline: string;
  source: string;
  reliability: "high" | "medium" | "low";
  sentiment: "positive" | "neutral" | "negative";
  relatedSymbols: string[];
  timestamp: string;
};

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<QuoteSnapshot>;
}

export interface EconomicDataProvider {
  getMacroSnapshot(): Promise<MacroSnapshot>;
}

export interface NewsDataProvider {
  getRelevantNews(symbol: string): Promise<NewsSnapshot[]>;
}

export interface FilingDataProvider {
  getRecentFilings(symbol: string): Promise<Array<{ symbol: string; formType: string; filedAt: string; source: string }>>;
}

export interface OptionsDataProvider {
  getOptionsSnapshot(symbol: string): Promise<{ symbol: string; impliedVolatilityPct: number; openInterest: number; observedAt: string }>;
}

export interface BrokerDataProvider {
  getBrokerSnapshot(): Promise<{ broker: string; mode: "paper" | "live_disabled"; accountSyncAvailable: boolean; observedAt: string }>;
}

export type MacroDataProvider = EconomicDataProvider;
export type NewsProvider = NewsDataProvider;

export class MockMarketDataProvider implements MarketDataProvider {
  async getQuote(symbol: string): Promise<QuoteSnapshot> {
    const normalized = symbol.toUpperCase();
    const fixtures: Record<string, Omit<QuoteSnapshot, "timestamp">> = {
      SPY: {
        symbol: "SPY",
        name: "SPDR S&P 500 ETF",
        price: 548.32,
        changePct: -0.74,
        volumeTrend: "rising",
      },
      QQQ: {
        symbol: "QQQ",
        name: "Nasdaq 100 ETF",
        price: 481.18,
        changePct: -1.21,
        volumeTrend: "rising",
      },
      MSFT: {
        symbol: "MSFT",
        name: "Microsoft",
        price: 432.18,
        changePct: -1.08,
        volumeTrend: "rising",
      },
      BA: {
        symbol: "BA",
        name: "Boeing",
        price: 178.64,
        changePct: -2.42,
        volumeTrend: "rising",
      },
      BTC: {
        symbol: "BTC",
        name: "Bitcoin",
        price: 64250,
        changePct: 1.86,
        volumeTrend: "rising",
      },
      SGOV: {
        symbol: "SGOV",
        name: "Short Treasury ETF",
        price: 100.42,
        changePct: 0.01,
        volumeTrend: "flat",
      },
      EURUSD: {
        symbol: "EURUSD",
        name: "Euro / US Dollar",
        price: 1.0812,
        changePct: -0.33,
        volumeTrend: "rising",
      },
    };

    return {
      ...(fixtures[normalized] ?? fixtures.SPY),
      timestamp: new Date().toISOString(),
    };
  }
}

export class MockMacroDataProvider implements MacroDataProvider {
  async getMacroSnapshot(): Promise<MacroSnapshot> {
    return {
      policyRateBias: "tightening",
      twoYearYieldChangeBps: 9,
      dollarChangePct: 0.38,
      inflationSurprise: "hotter",
      recessionRisk: "moderate",
      timestamp: new Date().toISOString(),
    };
  }
}

export class MockNewsProvider implements NewsProvider {
  async getRelevantNews(symbol: string): Promise<NewsSnapshot[]> {
    const normalized = symbol.toUpperCase();
    return [
      {
        headline:
          normalized === "SGOV"
            ? "Short-term Treasury yields hold firm as traders delay rate-cut expectations"
            : "Rate-sensitive assets slip after hotter inflation print lifts front-end yields",
        source: "MarketPilot demo newswire",
        reliability: "medium",
        sentiment: normalized === "SGOV" ? "neutral" : "negative",
        relatedSymbols: [normalized, "DXY", "US2Y"],
        timestamp: new Date().toISOString(),
      },
      {
        headline: "Fed speakers emphasize data dependence ahead of next policy meeting",
        source: "MarketPilot macro calendar",
        reliability: "medium",
        sentiment: "neutral",
        relatedSymbols: [normalized, "SPY", "TLT"],
        timestamp: new Date().toISOString(),
      },
    ];
  }
}

export class DemoFilingDataProvider implements FilingDataProvider {
  async getRecentFilings(symbol: string) {
    return [{
      symbol: symbol.toUpperCase(),
      formType: "10-Q",
      filedAt: new Date().toISOString(),
      source: "MarketPilot demo filings provider",
    }];
  }
}

export class DemoOptionsDataProvider implements OptionsDataProvider {
  async getOptionsSnapshot(symbol: string) {
    return {
      symbol: symbol.toUpperCase(),
      impliedVolatilityPct: 21.4,
      openInterest: 125000,
      observedAt: new Date().toISOString(),
    };
  }
}

export class DemoBrokerDataProvider implements BrokerDataProvider {
  async getBrokerSnapshot() {
    return {
      broker: "marketpilot_paper_broker",
      mode: "paper" as const,
      accountSyncAvailable: true,
      observedAt: new Date().toISOString(),
    };
  }
}
