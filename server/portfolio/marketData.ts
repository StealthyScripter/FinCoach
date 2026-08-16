import type { AssetClass, PortfolioQuote } from "./domain";

export type PortfolioMarketDataProvider = {
  id: string;
  capabilities(): { assetClasses: AssetClass[]; fixture: boolean; live: boolean };
  getQuote(symbol: string, assetClass: AssetClass, now?: Date): Promise<PortfolioQuote>;
};

const FIXTURE_PRICES: Record<string, { price: number; assetClass: AssetClass }> = {
  BIL: { price: 91.62, assetClass: "etf" },
  SHY: { price: 82.11, assetClass: "etf" },
  AGG: { price: 99.4, assetClass: "etf" },
  VIG: { price: 183.72, assetClass: "etf" },
  USMV: { price: 88.5, assetClass: "etf" },
  AOR: { price: 57.2, assetClass: "etf" },
  AOM: { price: 42.9, assetClass: "etf" },
  VTI: { price: 276.35, assetClass: "etf" },
  VTV: { price: 171.24, assetClass: "etf" },
  QUAL: { price: 176.9, assetClass: "etf" },
  VFMO: { price: 158.33, assetClass: "etf" },
  MTUM: { price: 207.18, assetClass: "etf" },
  DBMF: { price: 28.45, assetClass: "etf" },
  QQQ: { price: 481.17, assetClass: "etf" },
  SPY: { price: 545.39, assetClass: "etf" },
};

export class FixturePortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "portfolio-fixture-market-data";

  capabilities() {
    return { assetClasses: ["equity", "etf", "bond", "index_proxy", "commodity", "fx", "option"] as AssetClass[], fixture: true, live: false };
  }

  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    const quote = FIXTURE_PRICES[symbol.toUpperCase()];
    if (!quote || quote.assetClass !== assetClass && assetClass !== "index_proxy") throw new Error(`portfolio_quote_unsupported:${symbol}`);
    return {
      symbol: symbol.toUpperCase(),
      assetClass,
      bid: Number((quote.price * 0.999).toFixed(4)),
      ask: Number((quote.price * 1.001).toFixed(4)),
      last: quote.price,
      currency: "USD",
      observedAt: now.toISOString(),
      stale: false,
      source: this.id,
      fixture: true,
    };
  }
}

export class NoPortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "portfolio-market-data-disabled";

  capabilities() {
    return { assetClasses: [] as AssetClass[], fixture: false, live: false };
  }

  async getQuote(symbol: string): Promise<PortfolioQuote> {
    throw new Error(`portfolio_market_data_unavailable:${symbol}`);
  }
}

export function createPortfolioMarketDataProvider(kind: "fixture" | "none"): PortfolioMarketDataProvider {
  return kind === "fixture" ? new FixturePortfolioMarketDataProvider() : new NoPortfolioMarketDataProvider();
}
