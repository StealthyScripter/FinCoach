import assert from "node:assert/strict";
import { AlphaVantagePortfolioMarketDataProvider, FixturePortfolioMarketDataProvider, PortfolioMarketDataRouter, TwelveDataPortfolioMarketDataProvider, createPortfolioMarketDataProvider, marketDataCacheKey, providerError, type PortfolioMarketDataProvider } from "./portfolio/marketData";
import { optionMarketValue, settleExpiredOption } from "./portfolio/options";
import { loadPortfolioConfig } from "./portfolio/config";
import type { AssetClass, PortfolioHistoricalBar, PortfolioQuote } from "./portfolio/domain";
import { classifyMarketDataProvenance, ensureRealMarketDataForExecution } from "./marketDataProvenancePolicy";

const alphaCalls: string[] = [];
const alphaFetch = async (url: URL | RequestInfo) => {
  const href = String(url);
  alphaCalls.push(href);
  const parsed = new URL(href);
  const fn = parsed.searchParams.get("function");
  if (fn === "GLOBAL_QUOTE") return response({ "Global Quote": { "01. symbol": "SPY", "05. price": "545.39", "07. latest trading day": "2026-08-14" } });
  if (fn === "TIME_SERIES_DAILY_ADJUSTED") return response({ "Time Series (Daily)": { "2026-08-14": alphaDaily("545.39"), "2026-08-13": alphaDaily("540.00") } });
  if (fn === "SYMBOL_SEARCH") return response({ bestMatches: [{ "1. symbol": "SPY", "2. name": "SPDR S&P 500 ETF Trust", "3. type": "ETF", "4. region": "United States" }] });
  if (fn === "MARKET_STATUS") return response({ markets: [{ market_type: "Equity", region: "United States", primary_exchanges: "NASDAQ, NYSE", current_status: "open" }] });
  if (fn === "REALTIME_OPTIONS") return response({ data: [{ contractID: "SPY260918C00550000", type: "call", strike: "550", expiration: "2026-09-18", bid: "10.10", ask: "10.30", last: "10.20", volume: "100", open_interest: "2000", implied_volatility: "0.22" }] });
  throw new Error(`unexpected function ${fn}`);
};

const config = {
  alphaVantageApiKey: "test-key",
  twelveDataApiKey: "td-key",
  providerCallBudget: 100,
  providerTimeoutMs: 1_000,
  providerMaxConcurrency: 8,
  providerRateLimitCooldownMs: 300_000,
  providerCacheTtlMs: 60_000,
  quoteFreshnessMaxMinutes: 60 * 24 * 10,
  cacheEnabled: true,
  cacheMaxEntries: 100,
  cacheMaxBytes: null,
  cachePruneIntervalMs: 1_000,
  cacheExpiredRetentionMs: 1_000,
  marketDataProviders: ["twelve_data", "alpha_vantage"] as const,
};

class CountingProvider implements PortfolioMarketDataProvider {
  quoteCalls = 0;
  barCalls = 0;
  activeCalls = 0;
  maxActiveCalls = 0;
  fail = false;
  constructor(readonly id: string, private readonly delayMs: number) {}
  capabilities() {
    return { assetClasses: ["equity", "etf"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV"] as const, fixture: false, live: true, historical: true, latestQuote: true, search: false, marketStatus: false, options: false };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    this.quoteCalls += 1;
    this.activeCalls += 1;
    this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    try {
      if (this.fail) throw providerError("rate_limited", "rate limited");
      return { symbol: symbol.toUpperCase(), assetClass, bid: null, ask: null, last: 100 + this.quoteCalls, currency: "USD", observedAt: now.toISOString(), stale: false, source: this.id, fixture: false };
    } finally {
      this.activeCalls -= 1;
    }
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input = {} as { interval?: string; now?: Date }): Promise<PortfolioHistoricalBar[]> {
    this.barCalls += 1;
    if (this.fail) throw providerError("provider_unavailable", "down");
    const now = input.now ?? new Date();
    return [{ symbol: symbol.toUpperCase(), assetClass, open: 100, high: 101, low: 99, close: 100, adjustedClose: 100, volume: 1000, dividendAmount: 0, splitCoefficient: 1, observedAt: now.toISOString(), source: this.id, fixture: false }];
  }
}

class DurableCacheDouble {
  entries = new Map<string, any>();
  pruneCalls = 0;
  async get<T>(key: string): Promise<T | null> {
    return this.entries.get(key) ?? null;
  }
  async set(entry: any): Promise<void> {
    this.entries.set(entry.key, entry);
  }
  async pruneExpired(): Promise<number> {
    this.pruneCalls += 1;
    let pruned = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.staleUntil < Date.now()) {
        this.entries.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }
}

const alpha = new AlphaVantagePortfolioMarketDataProvider(config, alphaFetch as never);
assert.equal(alpha.capabilities().live, true);
assert.equal(alpha.capabilities().fixture, false);
assert.equal(alpha.capabilities().options, true);

const alphaRouter = new PortfolioMarketDataRouter([alpha], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
const quote = await alphaRouter.getQuote("spy", "etf", new Date("2026-08-15T12:00:00.000Z"));
assert.equal(quote.symbol, "SPY");
assert.equal(quote.last, 545.39);
assert.equal(quote.fixture, false);
assert.equal(quote.stale, false);
assert.equal(quote.marketData?.provider, "alpha-vantage");
assert.equal(quote.marketData?.cacheStatus, "miss");

const cachedQuote = await alphaRouter.getQuote("SPY", "etf", new Date("2026-08-15T12:00:01.000Z"));
assert.equal(cachedQuote.marketData?.cacheStatus, "hit");
assert.equal(alphaCalls.filter((item) => item.includes("GLOBAL_QUOTE")).length, 1, "one Portfolio request plus cache hit should make one provider call");
assert.ok(alphaCalls.every((item) => !item.includes("ALPHA_VANTAGE_API_KEY")));
assert.ok(alphaCalls.every((item) => !item.includes("td-key")));

const bars = await alphaRouter.getHistoricalBars("SPY", "etf");
assert.equal(bars.length, 2);
assert.equal(bars[0].close, 540);
assert.equal(bars[1].adjustedClose, 545.39);

const instruments = await alphaRouter.searchInstruments("spy");
assert.equal(instruments[0].symbol, "SPY");
assert.equal(instruments[0].assetClass, "etf");
assert.equal(instruments[0].benchmarkEligible, true);

const status = await alphaRouter.getMarketStatus();
assert.equal(status[0].status, "open");
const options = await alphaRouter.getOptionChain("SPY", { expiration: "2026-09-18", requireGreeks: true, now: new Date("2026-08-14T15:00:00.000Z") });
assert.equal(options[0].contractId, "SPY260918C00550000");
assert.equal(options[0].optionType, "call");
assert.equal(options[0].multiplier, 100);
assert.equal(options[0].lifecycle, "ACTIVE");
assert.equal(optionMarketValue(options[0], 2), 2040);
assert.equal(settleExpiredOption({ contract: { ...options[0], lifecycle: "EXPIRED" }, quantity: 1, underlyingQuote: null }).reason, "underlying_settlement_price_unavailable");
const settled = settleExpiredOption({ contract: { ...options[0], lifecycle: "EXPIRED" }, quantity: 1, underlyingQuote: { symbol: "SPY", assetClass: "etf", bid: null, ask: null, last: 560, currency: "USD", observedAt: "2026-09-18T21:00:00.000Z", stale: false, source: "alpha-vantage", fixture: false } });
assert.equal(settled.ok, true);
assert.equal(settled.cashSettlement, 1000);

const tdCalls: Array<{ url: string; auth: string | null }> = [];
const twelve = new TwelveDataPortfolioMarketDataProvider(config, (async (url: URL | RequestInfo, init?: RequestInit) => {
  tdCalls.push({ url: String(url), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") });
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith("/quote")) return response({ symbol: "SPY", close: "545.39", timestamp: 1786731600 }, 200, { "api-credits-used": "1", "api-credits-left": "99" });
  if (parsed.pathname.endsWith("/time_series")) return response({ values: [{ datetime: "2026-08-14", open: "540", high: "546", low: "539", close: "545.39", volume: "50000000" }, { datetime: "2026-08-13", open: "538", high: "542", low: "537", close: "540.00", volume: "45000000" }] }, 200, { "api-credits-used": "2", "api-credits-left": "98" });
  if (parsed.pathname.endsWith("/symbol_search")) return response({ data: [{ symbol: "SPY", instrument_name: "SPDR S&P 500 ETF Trust", instrument_type: "ETF", exchange: "NYSE", country: "United States" }] });
  throw new Error(`unexpected Twelve Data endpoint ${parsed.pathname}`);
}) as never);
const tdRouter = new PortfolioMarketDataRouter([twelve], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
const tdQuote = await tdRouter.getQuote("SPY", "etf", new Date("2026-08-14T20:00:00.000Z"));
assert.equal(tdQuote.source, "twelve-data");
assert.equal(tdQuote.last, 545.39);
assert.equal(tdQuote.marketData?.apiCreditsUsed, 1);
assert.equal(tdQuote.marketData?.apiCreditsLeft, 99);
assert.equal(twelve.health()?.creditsRemaining, 99);
const tdBars = await tdRouter.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "compact", now: new Date("2026-08-14T20:00:00.000Z") });
assert.equal(tdBars.length, 2);
assert.equal(tdBars[1].source, "twelve-data");
assert.equal(tdCalls[0].auth, "apikey td-key");
assert.ok(tdCalls.every((call) => !call.url.includes("td-key")), "Twelve Data key must not be placed in URLs");

const rateLimited = new TwelveDataPortfolioMarketDataProvider(config, (async () => response({ status: "error", code: 429, message: "rate limit" }, 429, { "api-credits-left": "0" })) as never);
await assert.rejects(() => rateLimited.getQuote("SPY", "etf"), (error: unknown) => (error as { code?: string }).code === "rate_limited");
assert.equal(rateLimited.health()?.quotaState, "rate_limited");

const oneCall = new CountingProvider("counting", 60);
const oneRouter = new PortfolioMarketDataRouter([oneCall], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
await oneRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:00.000Z"));
assert.equal(oneCall.quoteCalls, 1, "one Portfolio request should call provider once");
for (let index = 0; index < 10; index += 1) await oneRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:05.000Z"));
assert.equal(oneCall.quoteCalls, 1, "ten sequential identical requests inside TTL should call provider once");

const concurrentProvider = new CountingProvider("concurrent", 30);
const concurrentRouter = new PortfolioMarketDataRouter([concurrentProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
await Promise.all(Array.from({ length: 20 }, () => concurrentRouter.getQuote("MSFT", "equity", new Date("2026-08-17T15:00:00.000Z"))));
assert.equal(concurrentProvider.quoteCalls, 1, "twenty simultaneous identical requests should share one in-flight provider call");
assert.equal(concurrentRouter.telemetry().inFlightCoalescedRequests, 19);

await oneRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:20.000Z"));
assert.equal(oneCall.quoteCalls, 2, "request after TTL expiration should refresh once");
const refreshingProvider = new CountingProvider("refresh", 30);
const refreshingRouter = new PortfolioMarketDataRouter([refreshingProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
await refreshingRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:00.000Z"));
await Promise.all(Array.from({ length: 5 }, () => refreshingRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:20.000Z"))));
assert.equal(refreshingProvider.quoteCalls, 2, "callers arriving during refresh should share that refresh");

await oneRouter.getQuote("MSFT", "equity", new Date("2026-08-17T15:00:05.000Z"));
assert.equal(oneCall.quoteCalls, 3, "different symbols must use different cache entries");
await oneRouter.getHistoricalBars("AAPL", "equity", { interval: "1day", now: new Date("2026-08-17T15:00:00.000Z") });
await oneRouter.getHistoricalBars("AAPL", "equity", { interval: "15min", now: new Date("2026-08-17T15:00:00.000Z") });
assert.equal(oneCall.barCalls, 2, "different intervals must use different cache entries");

const staleProvider = new CountingProvider("stale", 0);
const staleRouter = new PortfolioMarketDataRouter([staleProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
await staleRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:00.000Z"));
staleProvider.fail = true;
const staleQuote = await staleRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:11.000Z"));
assert.equal(staleQuote.marketData?.freshnessState, "stale_revalidating");
assert.equal(staleQuote.stale, true, "stale data is never marked fresh");

const historicalProvider = new CountingProvider("history", 60);
const historicalRouter = new PortfolioMarketDataRouter([historicalProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null });
await historicalRouter.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:00.000Z") });
await historicalRouter.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:05.000Z") });
assert.equal(historicalProvider.barCalls, 1, "historical completed data should be reused");

const durable = new DurableCacheDouble();
const durableProvider = new CountingProvider("durable", 0);
const durableWriter = new PortfolioMarketDataRouter([durableProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null, cacheExpiredRetentionMs: 1_000 }, false, durable as never);
await durableWriter.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:00.000Z") });
assert.equal(durableProvider.barCalls, 1);
const durableReaderProvider = new CountingProvider("durable", 0);
const durableReader = new PortfolioMarketDataRouter([durableReaderProvider], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null, cacheExpiredRetentionMs: 1_000 }, false, durable as never);
const durableBars = await durableReader.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:05.000Z") });
assert.equal(durableReaderProvider.barCalls, 0, "durable L2 cache should avoid provider calls for completed historical data");
assert.equal(durableBars[0].marketData?.cacheStatus, "hit");
for (const entry of durable.entries.values()) entry.staleUntil = Date.now() - 1;
assert.deepEqual(await durableReader.pruneDurableCache(new Date()), { pruned: 1, durable: true });
assert.equal(durable.pruneCalls, 1, "durable cache cleanup should be callable through router maintenance");

const failing = new CountingProvider("failing", 30);
failing.fail = true;
const fallback = new CountingProvider("fallback", 30);
const fallbackAlerts: any[] = [];
const fallbackRouter = new PortfolioMarketDataRouter([failing, fallback], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null, providerRateLimitCooldownMs: 300_000 }, false, null, { record: async (event: any) => { fallbackAlerts.push(event); return event; } } as never);
const fallbackQuote = await fallbackRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:00.000Z"));
assert.equal(fallbackQuote.marketData?.dataKind, "REAL_PROVIDER_FALLBACK");
assert.equal(fallbackAlerts.length, 1, "real-provider fallback should emit one operator incident");
assert.equal(fallbackAlerts[0].alertCategory, "MARKET_DATA_FALLBACK");
await fallbackRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:01.000Z"));
assert.equal(failing.quoteCalls, 1, "fallback should not keep double-calling after valid cached fallback data exists");
assert.equal(fallback.quoteCalls, 1);
assert.equal(fallbackAlerts.length, 1, "cached fallback should not repeat-probe or flood alerts");
await fallbackRouter.getQuote("AAPL", "equity", new Date("2026-08-17T15:00:20.000Z"));
assert.equal(failing.quoteCalls, 1, "rate-limited primary remains on cooldown after fallback cache TTL expires");
assert.equal(fallback.quoteCalls, 2, "fallback provider refreshes while primary is cooling down");

const burstProvider = new CountingProvider("burst", 5);
const burstRouter = new PortfolioMarketDataRouter([burstProvider], { cacheEnabled: true, cacheMaxEntries: 500, cacheMaxBytes: null, providerMaxConcurrency: 8 });
await Promise.all(Array.from({ length: 400 }, (_, index) => burstRouter.getQuote(`SYM${index}`, "equity", new Date("2026-08-17T15:00:00.000Z"))));
assert.equal(burstProvider.quoteCalls, 400, "400 unique symbols should each make one provider call");
assert.ok(burstProvider.maxActiveCalls <= 8, `provider concurrency should be bounded to 8, saw ${burstProvider.maxActiveCalls}`);

const failingConcurrent = new CountingProvider("fail-concurrent", 5);
failingConcurrent.fail = true;
const failingConcurrentRouter = new PortfolioMarketDataRouter([failingConcurrent], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null, providerMaxConcurrency: 4 });
await assert.rejects(() => Promise.all(Array.from({ length: 20 }, () => failingConcurrentRouter.getQuote("FAIL", "equity", new Date("2026-08-17T15:00:00.000Z")))), /No configured provider returned quote/);
assert.equal(failingConcurrent.quoteCalls, 1, "failing identical requests should still coalesce to one failed upstream call");
failingConcurrent.fail = false;
await failingConcurrentRouter.getQuote("FAIL", "equity", new Date("2026-08-17T15:06:00.000Z"));
assert.equal(failingConcurrent.quoteCalls, 2, "in-flight failure should be removed so retry after cooldown can succeed");

const bounded = new PortfolioMarketDataRouter([new CountingProvider("bounded", 60)], { cacheEnabled: true, cacheMaxEntries: 2, cacheMaxBytes: null });
await bounded.getQuote("A", "equity", new Date("2026-08-17T15:00:00.000Z"));
await bounded.getQuote("B", "equity", new Date("2026-08-17T15:00:00.000Z"));
await bounded.getQuote("C", "equity", new Date("2026-08-17T15:00:00.000Z"));
assert.equal(bounded.telemetry().cacheEntries, 2, "cache capacity is bounded");
assert.equal(bounded.telemetry().cacheEvictions, 1);

assert.equal(marketDataCacheKey({ provider: "p", endpoint: "time_series", symbol: "AAPL", interval: "15min", timezone: "UTC", adjusted: true, outputSize: "compact" }), "portfolio-md|p|time_series|aapl|*|15min|*|utc|adjusted|compact|*|*|*|*|*|*");
assert.notEqual(
  marketDataCacheKey({ provider: "p", endpoint: "historical_options", symbol: "SPY", interval: "historical", requireGreeks: true }),
  marketDataCacheKey({ provider: "p", endpoint: "historical_options", symbol: "SPY", interval: "historical", requireGreeks: false }),
  "option greeks requirement must be part of the cache key",
);
await assert.rejects(() => alphaRouter.getQuote("SPY", "option"), /No configured provider returned quote/);
assert.throws(() => new AlphaVantagePortfolioMarketDataProvider({ ...config, alphaVantageApiKey: null }), /ALPHA_VANTAGE_API_KEY/);
assert.throws(() => new TwelveDataPortfolioMarketDataProvider({ ...config, twelveDataApiKey: null }), /TWELVE_DATA_API_KEY/);
const router = new PortfolioMarketDataRouter([new FixturePortfolioMarketDataProvider(), alpha], { cacheEnabled: true, cacheMaxEntries: 100, cacheMaxBytes: null }, true);
assert.equal(router.providerFor("QUOTE", "etf").id, "alpha-vantage");
assert.equal(router.providerFor("OPTIONS_CHAIN", "option").id, "alpha-vantage");

const provenanceAlerts: any[] = [];
assert.equal(classifyMarketDataProvenance({ workflow: "execution", provider: "alpha-vantage", fixture: false, stale: false }), "REAL_PROVIDER_DATA");
assert.equal(classifyMarketDataProvenance({ workflow: "execution", provider: "alpha-vantage", fallback: true }), "REAL_PROVIDER_FALLBACK");
assert.equal(classifyMarketDataProvenance({ workflow: "execution", provider: "fixture", fixture: true }), "FIXTURE_DATA");
const blockedFixture = await ensureRealMarketDataForExecution(
  { workflow: "execution", symbol: "SPY", provider: "portfolio-fixture-market-data", fixture: true },
  { record: async (event: any) => { provenanceAlerts.push(event); return event; } } as never,
  new Date("2026-08-17T15:00:00.000Z"),
);
assert.equal(blockedFixture.ok, false);
assert.equal(blockedFixture.reason, "real_market_data_required");
assert.equal(provenanceAlerts[0].alertCategory, "MARKET_DATA_FAILURE");
assert.equal((await ensureRealMarketDataForExecution({ workflow: "execution", symbol: "SPY", provider: "alpha-vantage", fallback: true }, { record: async (event: any) => { provenanceAlerts.push(event); return event; } } as never)).ok, true);

const chain = createPortfolioMarketDataProvider("twelve_data", {
  ...loadPortfolioConfig({ FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDERS: "twelve_data,alpha_vantage", TWELVE_DATA_API_KEY: "td", ALPHA_VANTAGE_API_KEY: "av", FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false" } as NodeJS.ProcessEnv),
});
assert.equal(chain.capabilities().latestQuote, true);
const loadedConfig = loadPortfolioConfig({ FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false", FINCOACH_PORTFOLIO_PROVIDER_MAX_CONCURRENCY: "7", FINCOACH_PORTFOLIO_PROVIDER_RATE_LIMIT_COOLDOWN_MS: "12345" } as NodeJS.ProcessEnv);
assert.equal(loadedConfig.providerMaxConcurrency, 7);
assert.equal(loadedConfig.providerRateLimitCooldownMs, 12345);
assert.throws(() => loadPortfolioConfig({ FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false", FINCOACH_PORTFOLIO_PROVIDER_MAX_CONCURRENCY: "0" } as NodeJS.ProcessEnv), /FINCOACH_PORTFOLIO_PROVIDER_MAX_CONCURRENCY/);

assert.throws(() => loadPortfolioConfig({ NODE_ENV: "production", FINCOACH_PORTFOLIO_ENABLED: "true", FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER: "fixture", FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false" } as NodeJS.ProcessEnv), /fixture is not allowed/);
assert.throws(() => loadPortfolioConfig({ FINCOACH_PORTFOLIO_ENABLED: "true", FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER: "alpha_vantage", FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false" } as NodeJS.ProcessEnv), /ALPHA_VANTAGE_API_KEY/);
assert.throws(() => loadPortfolioConfig({ FINCOACH_PORTFOLIO_ENABLED: "true", FINCOACH_PORTFOLIO_MARKET_DATA_PROVIDER: "twelve_data", FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false" } as NodeJS.ProcessEnv), /TWELVE_DATA_API_KEY/);
assert.throws(() => loadPortfolioConfig({ FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "true" } as NodeJS.ProcessEnv), /must remain false/);

function response(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response;
}
function alphaDaily(close: string) {
  return { "1. open": "540", "2. high": "546", "3. low": "539", "4. close": close, "5. adjusted close": close, "6. volume": "50000000", "7. dividend amount": "0", "8. split coefficient": "1" };
}
