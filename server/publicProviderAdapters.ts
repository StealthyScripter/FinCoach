import type { EconomicObservation, PriceBar } from "./timeSeriesStoreService";

export type PublicProviderHealth = {
  id: string;
  configured: boolean;
  status: "healthy" | "disabled";
  capabilities: string[];
  freshness: string;
};

export class FredProviderAdapter {
  health(): PublicProviderHealth {
    return { id: "fred", configured: Boolean(process.env.FRED_API_KEY), status: process.env.FRED_API_KEY ? "healthy" : "disabled", capabilities: ["economic_observations"], freshness: "env-gated" };
  }
  async getObservation(seriesId = "DGS2"): Promise<EconomicObservation> {
    return { seriesId, timestamp: new Date().toISOString(), value: 4.72, source: "FRED adapter demo fallback" };
  }
}

export class SecEdgarProviderAdapter {
  health(): PublicProviderHealth {
    return { id: "sec-edgar", configured: true, status: "healthy", capabilities: ["filings_metadata"], freshness: "demo" };
  }
  async getLatestFiling(symbol = "SPY") {
    return { symbol, formType: "N-PORT", filedAt: new Date().toISOString(), source: "SEC EDGAR adapter demo fallback" };
  }
}

export class DemoYahooStooqMarketAdapter {
  health(): PublicProviderHealth {
    return { id: "public-market-demo", configured: true, status: "healthy", capabilities: ["ohlcv"], freshness: "demo" };
  }
  async getDailyBar(symbol = "SPY"): Promise<PriceBar> {
    return { symbol, timestamp: new Date().toISOString(), open: 546, high: 551, low: 544, close: 548.32, volume: 74_000_000 };
  }
}

export class PublicEconomicCalendarAdapter {
  health(): PublicProviderHealth {
    return { id: "public-economic-calendar", configured: true, status: "healthy", capabilities: ["calendar_placeholder"], freshness: "demo" };
  }
  async getNextEvent() {
    return { title: "CPI release placeholder", startsAt: new Date().toISOString(), impact: "high" as const };
  }
}

export const publicProviderAdapters = {
  fred: new FredProviderAdapter(),
  sec: new SecEdgarProviderAdapter(),
  market: new DemoYahooStooqMarketAdapter(),
  calendar: new PublicEconomicCalendarAdapter(),
};
