import assert from "node:assert/strict";
import { AlphaVantagePortfolioMarketDataProvider, FixturePortfolioMarketDataProvider, PortfolioMarketDataRouter } from "./portfolio/marketData";
import { optionMarketValue, settleExpiredOption } from "./portfolio/options";
import { loadPortfolioConfig } from "./portfolio/config";

const calls: string[] = [];
const fetchMock = async (url: URL | RequestInfo) => {
  const href = String(url);
  calls.push(href);
  const parsed = new URL(href);
  const fn = parsed.searchParams.get("function");
  if (fn === "GLOBAL_QUOTE") {
    return response({ "Global Quote": { "01. symbol": "SPY", "05. price": "545.39", "06. volume": "50000000", "07. latest trading day": "2026-08-14" } });
  }
  if (fn === "TIME_SERIES_DAILY_ADJUSTED") {
    return response({
      "Time Series (Daily)": {
        "2026-08-14": { "1. open": "540", "2. high": "546", "3. low": "539", "4. close": "545.39", "5. adjusted close": "545.39", "6. volume": "50000000", "7. dividend amount": "0", "8. split coefficient": "1" },
        "2026-08-13": { "1. open": "538", "2. high": "542", "3. low": "537", "4. close": "540.00", "5. adjusted close": "540.00", "6. volume": "45000000", "7. dividend amount": "0", "8. split coefficient": "1" },
      },
    });
  }
  if (fn === "SYMBOL_SEARCH") {
    return response({ bestMatches: [{ "1. symbol": "SPY", "2. name": "SPDR S&P 500 ETF Trust", "3. type": "ETF", "4. region": "United States" }] });
  }
  if (fn === "MARKET_STATUS") {
    return response({ markets: [{ market_type: "Equity", region: "United States", primary_exchanges: "NASDAQ, NYSE", current_status: "open" }] });
  }
  if (fn === "REALTIME_OPTIONS") {
    return response({ data: [{ contractID: "SPY260918C00550000", type: "call", strike: "550", expiration: "2026-09-18", bid: "10.10", ask: "10.30", last: "10.20", volume: "100", open_interest: "2000", implied_volatility: "0.22" }] });
  }
  throw new Error(`unexpected function ${fn}`);
};

const config = {
  alphaVantageApiKey: "test-key",
  providerCallBudget: 10,
  providerTimeoutMs: 1_000,
  providerCacheTtlMs: 60_000,
  quoteFreshnessMaxMinutes: 60 * 24 * 10,
};
const provider = new AlphaVantagePortfolioMarketDataProvider(config, fetchMock as never);
assert.equal(provider.capabilities().live, true);
assert.equal(provider.capabilities().fixture, false);
assert.equal(provider.capabilities().options, true);

const quote = await provider.getQuote("spy", "etf", new Date("2026-08-15T12:00:00.000Z"));
assert.equal(quote.symbol, "SPY");
assert.equal(quote.last, 545.39);
assert.equal(quote.fixture, false);
assert.equal(quote.stale, false);

const bars = await provider.getHistoricalBars!("SPY", "etf");
assert.equal(bars.length, 2);
assert.equal(bars[0].close, 540);
assert.equal(bars[1].adjustedClose, 545.39);

const instruments = await provider.searchInstruments!("spy");
assert.equal(instruments[0].symbol, "SPY");
assert.equal(instruments[0].assetClass, "etf");
assert.equal(instruments[0].benchmarkEligible, true);

const status = await provider.getMarketStatus!();
assert.equal(status[0].status, "open");
const options = await provider.getOptionChain!("SPY", { expiration: "2026-09-18", requireGreeks: true, now: new Date("2026-08-14T15:00:00.000Z") });
assert.equal(options[0].contractId, "SPY260918C00550000");
assert.equal(options[0].optionType, "call");
assert.equal(options[0].multiplier, 100);
assert.equal(options[0].lifecycle, "ACTIVE");
assert.equal(optionMarketValue(options[0], 2), 2040);
assert.equal(settleExpiredOption({ contract: { ...options[0], lifecycle: "EXPIRED" }, quantity: 1, underlyingQuote: null }).reason, "underlying_settlement_price_unavailable");
const settled = settleExpiredOption({ contract: { ...options[0], lifecycle: "EXPIRED" }, quantity: 1, underlyingQuote: { symbol: "SPY", assetClass: "etf", bid: null, ask: null, last: 560, currency: "USD", observedAt: "2026-09-18T21:00:00.000Z", stale: false, source: "alpha-vantage", fixture: false } });
assert.equal(settled.ok, true);
assert.equal(settled.cashSettlement, 1000);

await provider.getQuote("SPY", "etf");
assert.equal(calls.filter((item) => item.includes("GLOBAL_QUOTE")).length, 1, "quote cache should avoid duplicate provider calls");
assert.ok(calls.every((item) => !item.includes("ALPHA_VANTAGE_API_KEY")));

await assert.rejects(() => provider.getQuote("SPY", "option"), /getOptionChain/);
assert.throws(() => new AlphaVantagePortfolioMarketDataProvider({ ...config, alphaVantageApiKey: null }), /ALPHA_VANTAGE_API_KEY/);
const router = new PortfolioMarketDataRouter([new FixturePortfolioMarketDataProvider(), provider], true);
assert.equal(router.providerFor("QUOTE", "etf").id, "alpha-vantage");
assert.equal(router.providerFor("OPTIONS_CHAIN", "option").id, "alpha-vantage");

assert.throws(() => loadPortfolioConfig({
  NODE_ENV: "production",
  FINCOACH_PORTFOLIO_ENABLED: "true",
  FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER: "fixture",
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false",
} as NodeJS.ProcessEnv), /fixture is not allowed/);

assert.throws(() => loadPortfolioConfig({
  FINCOACH_PORTFOLIO_ENABLED: "true",
  FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER: "alpha_vantage",
  FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false",
} as NodeJS.ProcessEnv), /ALPHA_VANTAGE_API_KEY/);

function response(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
