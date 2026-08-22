import { Pool } from "pg";
import type { AssetClass, PortfolioHistoricalBar, PortfolioInstrument, PortfolioMarketDataCapability, PortfolioMarketDataFreshnessState, PortfolioMarketDataProvenance, PortfolioMarketStatus, PortfolioOptionContract, PortfolioQuote } from "./domain";
import type { PortfolioConfig, PortfolioMarketDataProviderKind } from "./config";
import { operationalBlockerService, type OperationalBlockerService } from "../operationalBlockerService";

export type PortfolioMarketDataProvider = {
  id: string;
  capabilities(): { assetClasses: AssetClass[]; capabilities: PortfolioMarketDataCapability[]; fixture: boolean; live: boolean; historical: boolean; latestQuote: boolean; search: boolean; marketStatus: boolean; options: boolean };
  getQuote(symbol: string, assetClass: AssetClass, now?: Date): Promise<PortfolioQuote>;
  getHistoricalBars?(symbol: string, assetClass: AssetClass, input?: PortfolioHistoricalRequest): Promise<PortfolioHistoricalBar[]>;
  searchInstruments?(keywords: string): Promise<PortfolioInstrument[]>;
  getMarketStatus?(now?: Date): Promise<PortfolioMarketStatus[]>;
  getOptionChain?(underlying: string, input?: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date }): Promise<PortfolioOptionContract[]>;
  health?(): PortfolioProviderHealth;
};

export type PortfolioHistoricalRequest = { outputSize?: "compact" | "full"; interval?: PortfolioMarketDataInterval; startDate?: string; endDate?: string; timezone?: string; adjusted?: boolean; now?: Date };
export type PortfolioMarketDataInterval = "1min" | "5min" | "15min" | "30min" | "60min" | "1day";
export type PortfolioProviderQuotaState = "healthy" | "approaching_quota" | "waiting_for_quota" | "rate_limited" | "provider_unavailable";
export type PortfolioProviderHealth = { provider: string; quotaState: PortfolioProviderQuotaState; lastSuccessfulRefresh: Record<string, string>; creditsUsed: number | null; creditsRemaining: number | null };
export type PortfolioMarketDataTelemetry = {
  portfolioMarketDataRequests: number;
  portfolioProviderRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  inFlightCoalescedRequests: number;
  providerCallsAvoided: number;
  cacheFreshHits: number;
  cacheStaleHits: number;
  cacheEntries: number;
  cacheEvictions: number;
  providerCallsByProvider: Record<string, number>;
  providerCallsByEndpoint: Record<string, number>;
  providerRateLimitEvents: number;
  providerCreditsUsed: Record<string, number>;
  providerCreditsRemaining: Record<string, number>;
  uniqueSymbolsRequested: number;
  uniqueProviderRequests: number;
};

type CacheableValue = PortfolioQuote | PortfolioHistoricalBar[] | PortfolioInstrument[] | PortfolioMarketStatus[] | PortfolioOptionContract[];
type ProviderFetch<T extends CacheableValue> = (provider: PortfolioMarketDataProvider) => Promise<T>;
type CacheEntry<T extends CacheableValue = CacheableValue> = { key: string; value: T; bytes: number; fetchedAt: number; expiresAt: number; staleUntil: number; providerTimestamp: string | null; provenance: Omit<PortfolioMarketDataProvenance, "freshnessState"> };
type CacheKeyInput = { provider: string; endpoint: string; symbol?: string; interval?: string | null; assetClass?: AssetClass; exchange?: string | null; timezone?: string | null; adjusted?: boolean | null; outputSize?: string | null; startDate?: string | null; endDate?: string | null; contract?: string | null; expiration?: string | null; historicalDate?: string | null; requireGreeks?: boolean | null };
type DurablePortfolioMarketDataCache = { get<T extends CacheableValue>(key: string): Promise<CacheEntry<T> | null>; set<T extends CacheableValue>(entry: CacheEntry<T>): Promise<void>; pruneExpired?(input?: { olderThan?: Date; limit?: number }): Promise<number> };

const FIXTURE_PRICES: Record<string, { price: number; assetClass: AssetClass }> = {
  BIL: { price: 91.62, assetClass: "etf" }, SHY: { price: 82.11, assetClass: "etf" }, AGG: { price: 99.4, assetClass: "etf" },
  VIG: { price: 183.72, assetClass: "etf" }, USMV: { price: 88.5, assetClass: "etf" }, AOR: { price: 57.2, assetClass: "etf" },
  AOM: { price: 42.9, assetClass: "etf" }, VTI: { price: 276.35, assetClass: "etf" }, VTV: { price: 171.24, assetClass: "etf" },
  QUAL: { price: 176.9, assetClass: "etf" }, VFMO: { price: 158.33, assetClass: "etf" }, MTUM: { price: 207.18, assetClass: "etf" },
  DBMF: { price: 28.45, assetClass: "etf" }, QQQ: { price: 481.17, assetClass: "etf" }, SPY: { price: 545.39, assetClass: "etf" },
};

export class FixturePortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "portfolio-fixture-market-data";
  capabilities() {
    return { assetClasses: ["equity", "etf", "bond", "index_proxy", "commodity", "fx", "option"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "MARKET_STATUS"] as PortfolioMarketDataCapability[], fixture: true, live: false, historical: true, latestQuote: true, search: true, marketStatus: true, options: false };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    const quote = FIXTURE_PRICES[symbol.toUpperCase()];
    if (!quote || quote.assetClass !== assetClass && assetClass !== "index_proxy") throw providerError("unsupported_symbol", `portfolio_quote_unsupported:${symbol}`);
    return { symbol: symbol.toUpperCase(), assetClass, bid: Number((quote.price * 0.999).toFixed(4)), ask: Number((quote.price * 1.001).toFixed(4)), last: quote.price, currency: "USD", observedAt: now.toISOString(), stale: false, source: this.id, fixture: true };
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: { now?: Date } = {}) {
    const quote = await this.getQuote(symbol, assetClass, input.now);
    return Array.from({ length: 60 }, (_, index): PortfolioHistoricalBar => {
      const date = new Date(Date.parse(quote.observedAt) - (59 - index) * 86_400_000);
      const close = Number((quote.last * (1 + (index - 30) * 0.0005)).toFixed(4));
      return { symbol: quote.symbol, assetClass, open: close, high: close, low: close, close, adjustedClose: close, volume: 1_000_000, dividendAmount: 0, splitCoefficient: 1, observedAt: date.toISOString(), source: this.id, fixture: true };
    });
  }
  async searchInstruments(keywords: string): Promise<PortfolioInstrument[]> {
    return Object.keys(FIXTURE_PRICES).filter((symbol) => symbol.includes(keywords.toUpperCase())).map((symbol) => instrument(symbol, symbol, FIXTURE_PRICES[symbol].assetClass, this.id));
  }
  async getMarketStatus(now = new Date()): Promise<PortfolioMarketStatus[]> {
    return [{ market: "United States", region: "United States", primaryExchanges: ["NYSE", "NASDAQ"], status: usEquityMarketOpen(now) ? "open" : "closed", reason: usEquityMarketOpen(now) ? "regular" : "outside_hours", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: this.id }];
  }
}

export class NoPortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "portfolio-market-data-disabled";
  capabilities() { return { assetClasses: [] as AssetClass[], capabilities: [] as PortfolioMarketDataCapability[], fixture: false, live: false, historical: false, latestQuote: false, search: false, marketStatus: false, options: false }; }
  async getQuote(symbol: string): Promise<PortfolioQuote> { throw providerError("provider_unavailable", `portfolio_market_data_unavailable:${symbol}`); }
}

abstract class RestPortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  protected calls = 0;
  protected quotaState: PortfolioProviderQuotaState = "healthy";
  protected lastSuccessfulRefresh: Record<string, string> = {};
  protected creditsUsed: number | null = null;
  protected creditsRemaining: number | null = null;
  abstract id: string;
  abstract capabilities(): ReturnType<PortfolioMarketDataProvider["capabilities"]>;
  abstract getQuote(symbol: string, assetClass: AssetClass, now?: Date): Promise<PortfolioQuote>;
  getHistoricalBars?(symbol: string, assetClass: AssetClass, input?: PortfolioHistoricalRequest): Promise<PortfolioHistoricalBar[]>;
  searchInstruments?(keywords: string): Promise<PortfolioInstrument[]>;
  getMarketStatus?(now?: Date): Promise<PortfolioMarketStatus[]>;
  getOptionChain?(underlying: string, input?: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date }): Promise<PortfolioOptionContract[]>;
  constructor(protected readonly config: Pick<PortfolioConfig, "providerCallBudget" | "providerTimeoutMs">, protected readonly fetchImpl: typeof fetch = fetch) {}
  health(): PortfolioProviderHealth { return { provider: this.id, quotaState: this.quotaState, lastSuccessfulRefresh: { ...this.lastSuccessfulRefresh }, creditsUsed: this.creditsUsed, creditsRemaining: this.creditsRemaining }; }
  protected beforeProviderCall(endpoint: string) {
    if (this.calls >= this.config.providerCallBudget) throw providerError("provider_budget_exhausted", `${this.id} Portfolio provider call budget exhausted.`);
    this.calls += 1;
  }
  protected afterProviderSuccess(endpoint: string) { this.lastSuccessfulRefresh[endpoint] = new Date().toISOString(); }
  protected captureCredits(response: Response) {
    const used = headerNumber(response, "api-credits-used");
    const left = headerNumber(response, "api-credits-left");
    if (used !== null) this.creditsUsed = used;
    if (left !== null) this.creditsRemaining = left;
    if (left !== null) this.quotaState = left <= 0 ? "waiting_for_quota" : left <= 10 ? "approaching_quota" : "healthy";
  }
  protected categorizeFailure(error: unknown): never {
    if ((error as { name?: string }).name === "AbortError") throw providerError("timeout", `${this.id} request timed out.`);
    if (error instanceof TypeError) {
      this.quotaState = "provider_unavailable";
      throw providerError("network_error", `${this.id} network request failed.`);
    }
    throw error;
  }
}

export class AlphaVantagePortfolioMarketDataProvider extends RestPortfolioMarketDataProvider {
  id = "alpha-vantage";
  constructor(private readonly alphaConfig: Pick<PortfolioConfig, "alphaVantageApiKey" | "providerCallBudget" | "providerTimeoutMs" | "quoteFreshnessMaxMinutes">, fetchImpl: typeof fetch = fetch) {
    super(alphaConfig, fetchImpl);
    if (!alphaConfig.alphaVantageApiKey?.trim()) throw new Error("ALPHA_VANTAGE_API_KEY is required for Alpha Vantage Portfolio market data.");
  }
  capabilities() {
    return { assetClasses: ["equity", "etf", "index_proxy", "option"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "REFERENCE_DATA", "CORPORATE_ACTIONS", "OPTIONS_CHAIN", "OPTION_QUOTES", "MARKET_STATUS", "INDEX_DATA", "ETF_DATA"] as PortfolioMarketDataCapability[], fixture: false, live: true, historical: true, latestQuote: true, search: true, marketStatus: true, options: true };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    this.requireSupported(assetClass);
    const data = await this.query("GLOBAL_QUOTE", { symbol: symbol.toUpperCase() });
    const quote = object(data["Global Quote"]);
    const price = number(quote["05. price"]);
    const tradingDay = string(quote["07. latest trading day"]);
    if (!price || !tradingDay) throw providerError("malformed_response", `Alpha Vantage quote for ${symbol} did not include price/trading day.`);
    const observedAt = new Date(`${tradingDay}T21:00:00.000Z`).toISOString();
    return { symbol: symbol.toUpperCase(), assetClass, bid: null, ask: null, last: price, currency: "USD", observedAt, stale: now.getTime() - Date.parse(observedAt) > this.alphaConfig.quoteFreshnessMaxMinutes * 60_000, source: this.id, fixture: false };
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: PortfolioHistoricalRequest = {}): Promise<PortfolioHistoricalBar[]> {
    this.requireSupported(assetClass);
    const data = await this.query("TIME_SERIES_DAILY_ADJUSTED", { symbol: symbol.toUpperCase(), outputsize: input.outputSize ?? "compact" });
    const series = object(data["Time Series (Daily)"]);
    const rows = Object.entries(series).map(([date, value]) => {
      const row = object(value);
      const close = requiredNumber(row["4. close"], `daily close ${symbol} ${date}`);
      return { symbol: symbol.toUpperCase(), assetClass, open: requiredNumber(row["1. open"], `daily open ${symbol} ${date}`), high: requiredNumber(row["2. high"], `daily high ${symbol} ${date}`), low: requiredNumber(row["3. low"], `daily low ${symbol} ${date}`), close, adjustedClose: number(row["5. adjusted close"]), volume: requiredNumber(row["6. volume"], `daily volume ${symbol} ${date}`), dividendAmount: number(row["7. dividend amount"]), splitCoefficient: number(row["8. split coefficient"]), observedAt: new Date(`${date}T21:00:00.000Z`).toISOString(), source: this.id, fixture: false } satisfies PortfolioHistoricalBar;
    }).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!rows.length) throw providerError("malformed_response", `Alpha Vantage historical data for ${symbol} was empty.`);
    return rows;
  }
  async searchInstruments(keywords: string): Promise<PortfolioInstrument[]> {
    const data = await this.query("SYMBOL_SEARCH", { keywords });
    const matches = Array.isArray(data.bestMatches) ? data.bestMatches : [];
    return matches.map((item: unknown) => {
      const row = object(item);
      const symbol = string(row["1. symbol"]) || "UNKNOWN";
      return instrument(symbol, string(row["2. name"]) || symbol, classifyAsset(string(row["3. type"])), this.id, { exchange: string(row["4. region"]) || null, currency: "USD", country: string(row["4. region"]) || null });
    });
  }
  async getMarketStatus(now = new Date()): Promise<PortfolioMarketStatus[]> {
    const data = await this.query("MARKET_STATUS", {});
    const markets = Array.isArray(data.markets) ? data.markets : [];
    const mapped = markets.map((item: unknown): PortfolioMarketStatus => {
      const row = object(item);
      const status = String(row.current_status ?? "").toLowerCase() === "open" ? "open" : String(row.current_status ?? "").toLowerCase() === "closed" ? "closed" : "unknown";
      return { market: string(row.market_type) || "unknown", region: string(row.region) || "unknown", primaryExchanges: [string(row.primary_exchanges)].filter(Boolean), status, reason: status === "open" ? "regular" : "outside_hours", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: this.id };
    });
    return mapped.length ? mapped : [{ market: "unknown", region: "unknown", primaryExchanges: [], status: "unknown", reason: "provider_unavailable", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: this.id }];
  }
  async getOptionChain(underlying: string, input: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date } = {}): Promise<PortfolioOptionContract[]> {
    const params: Record<string, string> = { symbol: underlying.toUpperCase() };
    if (input.expiration) params.expiration = input.expiration;
    if (input.contract) params.contract = input.contract;
    if (input.requireGreeks) params.require_greeks = "true";
    if (input.historicalDate) params.date = input.historicalDate;
    const functionName = input.historicalDate ? "HISTORICAL_OPTIONS" : "REALTIME_OPTIONS";
    const data = await this.query(functionName, params);
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.options) ? data.options : [];
    return rows.map((item: unknown) => mapAlphaOption(object(item), underlying.toUpperCase(), this.id, input.now ?? new Date()));
  }
  private requireSupported(assetClass: AssetClass) {
    if (assetClass === "option") throw providerError("unsupported_asset", "Use getOptionChain for option contracts.");
    if (!this.capabilities().assetClasses.includes(assetClass)) throw providerError("unsupported_asset", `Alpha Vantage provider does not support ${assetClass} in Portfolio mode.`);
  }
  private async query(functionName: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    this.beforeProviderCall(functionName);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.providerTimeoutMs);
    try {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", functionName);
      url.searchParams.set("apikey", this.alphaConfig.alphaVantageApiKey!);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw providerError(response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "authentication_error" : "http_error", `Alpha Vantage request failed with HTTP ${response.status}.`);
      const data = await response.json() as Record<string, unknown>;
      if (data["Error Message"]) throw providerError("provider_error", String(data["Error Message"]));
      if (data.Note || data.Information) {
        this.quotaState = "rate_limited";
        throw providerError("rate_limited", String(data.Note ?? data.Information));
      }
      this.quotaState = "healthy";
      this.afterProviderSuccess(functionName);
      return data;
    } catch (error) {
      this.categorizeFailure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TwelveDataPortfolioMarketDataProvider extends RestPortfolioMarketDataProvider {
  id = "twelve-data";
  constructor(private readonly twelveConfig: Pick<PortfolioConfig, "twelveDataApiKey" | "providerCallBudget" | "providerTimeoutMs" | "quoteFreshnessMaxMinutes">, fetchImpl: typeof fetch = fetch) {
    super(twelveConfig, fetchImpl);
    if (!twelveConfig.twelveDataApiKey?.trim()) throw new Error("TWELVE_DATA_API_KEY is required for Twelve Data Portfolio market data.");
  }
  capabilities() {
    return { assetClasses: ["equity", "etf", "index_proxy"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "REFERENCE_DATA", "MARKET_STATUS", "INDEX_DATA", "ETF_DATA"] as PortfolioMarketDataCapability[], fixture: false, live: true, historical: true, latestQuote: true, search: true, marketStatus: true, options: false };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    this.requireSupported(assetClass);
    const data = await this.query("quote", { symbol: symbol.toUpperCase() });
    if (String(data.status ?? "").toLowerCase() === "error") throw providerError("provider_error", String(data.message ?? `Twelve Data quote failed for ${symbol}.`));
    const price = number(data.close ?? data.price);
    const observedAt = providerTimestamp(data.timestamp ?? data.datetime, now);
    if (price === null) throw providerError("malformed_response", `Twelve Data quote for ${symbol} did not include close/price.`);
    return { symbol: string(data.symbol) || symbol.toUpperCase(), assetClass, bid: number(data.bid), ask: number(data.ask), last: price, currency: "USD", observedAt, stale: now.getTime() - Date.parse(observedAt) > this.twelveConfig.quoteFreshnessMaxMinutes * 60_000, source: this.id, fixture: false };
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: PortfolioHistoricalRequest = {}): Promise<PortfolioHistoricalBar[]> {
    this.requireSupported(assetClass);
    const interval = input.interval ?? "1day";
    const params: Record<string, string> = { symbol: symbol.toUpperCase(), interval, outputsize: input.outputSize === "full" ? "5000" : "100", timezone: input.timezone ?? "UTC" };
    if (input.startDate) params.start_date = input.startDate;
    if (input.endDate) params.end_date = input.endDate;
    if (input.adjusted === false) params.adjust = "false";
    const data = await this.query("time_series", params);
    if (String(data.status ?? "").toLowerCase() === "error") throw providerError(errorCodeFromTwelveData(data.code), String(data.message ?? `Twelve Data time_series failed for ${symbol}.`));
    const values = Array.isArray(data.values) ? data.values : [];
    const rows = values.map((item: unknown): PortfolioHistoricalBar => {
      const row = object(item);
      const observedAt = providerTimestamp(row.datetime, input.now ?? new Date());
      return { symbol: symbol.toUpperCase(), assetClass, open: requiredNumber(row.open, `Twelve Data open ${symbol}`), high: requiredNumber(row.high, `Twelve Data high ${symbol}`), low: requiredNumber(row.low, `Twelve Data low ${symbol}`), close: requiredNumber(row.close, `Twelve Data close ${symbol}`), adjustedClose: number(row.adjusted_close), volume: number(row.volume) ?? 0, dividendAmount: null, splitCoefficient: null, observedAt, source: this.id, fixture: false };
    }).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!rows.length) throw providerError("malformed_response", `Twelve Data historical data for ${symbol} was empty.`);
    return rows;
  }
  async searchInstruments(keywords: string): Promise<PortfolioInstrument[]> {
    const data = await this.query("symbol_search", { symbol: keywords });
    const matches = Array.isArray(data.data) ? data.data : [];
    return matches.map((item: unknown) => {
      const row = object(item);
      const symbol = string(row.symbol) || "UNKNOWN";
      return instrument(symbol, string(row.instrument_name) || symbol, classifyAsset(string(row.instrument_type)), this.id, { exchange: string(row.exchange) || null, country: string(row.country) || null, currency: "USD" });
    });
  }
  async getMarketStatus(now = new Date()): Promise<PortfolioMarketStatus[]> {
    return [{ market: "Equity", region: "United States", primaryExchanges: ["NYSE", "NASDAQ"], status: usEquityMarketOpen(now) ? "open" : "closed", reason: usEquityMarketOpen(now) ? "regular" : "outside_hours", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: this.id }];
  }
  private requireSupported(assetClass: AssetClass) {
    if (!this.capabilities().assetClasses.includes(assetClass)) throw providerError("unsupported_asset", `Twelve Data provider does not support ${assetClass} in Portfolio mode.`);
  }
  private async query(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    this.beforeProviderCall(endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.providerTimeoutMs);
    try {
      const url = new URL(`https://api.twelvedata.com/${endpoint}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Authorization: `apikey ${this.twelveConfig.twelveDataApiKey}` } });
      this.captureCredits(response);
      if (!response.ok) {
        if (response.status === 429) this.quotaState = "rate_limited";
        throw providerError(response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "authentication_error" : "http_error", `Twelve Data request failed with HTTP ${response.status}.`);
      }
      const data = await response.json() as Record<string, unknown>;
      const status = String(data.status ?? "").toLowerCase();
      if (status === "error") throw providerError(errorCodeFromTwelveData(data.code), String(data.message ?? `Twelve Data ${endpoint} returned an error.`));
      this.afterProviderSuccess(endpoint);
      return data;
    } catch (error) {
      this.categorizeFailure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class PortfolioMarketDataCache {
  private entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private evictions = 0;
  constructor(private readonly maxEntries = 2_000, private readonly maxBytes: number | null = null) {}
  get<T extends CacheableValue>(key: string, now = Date.now()) {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    const freshnessState: PortfolioMarketDataFreshnessState = now <= entry.expiresAt ? "fresh" : now <= entry.staleUntil ? "stale_revalidating" : "expired";
    return { entry, freshnessState };
  }
  set<T extends CacheableValue>(entry: CacheEntry<T>) {
    const existing = this.entries.get(entry.key);
    if (existing) this.totalBytes -= existing.bytes;
    this.entries.set(entry.key, entry);
    this.totalBytes += entry.bytes;
    this.evict();
  }
  size() { return this.entries.size; }
  evictionsCount() { return this.evictions; }
  private evict() {
    while (this.entries.size > this.maxEntries || this.maxBytes !== null && this.totalBytes > this.maxBytes) {
      const first = this.entries.keys().next().value as string | undefined;
      if (!first) return;
      const entry = this.entries.get(first);
      this.entries.delete(first);
      this.totalBytes -= entry?.bytes ?? 0;
      this.evictions += 1;
    }
  }
}

export class PgPortfolioMarketDataCache implements DurablePortfolioMarketDataCache {
  private readonly pool: Pool;
  private lastPrunedAt = 0;
  constructor(databaseUrl = process.env.DATABASE_URL, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
  }
  async get<T extends CacheableValue>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const result = await this.pool.query("SELECT * FROM portfolio_market_data_cache WHERE cache_key = $1 AND stale_until > now()", [key]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        key,
        value: row.payload as T,
        bytes: Number(row.payload_bytes),
        fetchedAt: new Date(row.fetched_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        staleUntil: new Date(row.stale_until).getTime(),
        providerTimestamp: row.provider_timestamp ? new Date(row.provider_timestamp).toISOString() : null,
        provenance: {
          provider: String(row.provider),
          symbol: row.symbol ? String(row.symbol) : "*",
          endpoint: String(row.endpoint),
          interval: row.interval ? String(row.interval) : null,
          providerTimestamp: row.provider_timestamp ? new Date(row.provider_timestamp).toISOString() : null,
          fetchedAt: new Date(row.fetched_at).toISOString(),
          expiresAt: new Date(row.expires_at).toISOString(),
          staleUntil: new Date(row.stale_until).toISOString(),
          cacheStatus: "hit",
        },
      };
    } catch {
      return null;
    }
  }
  async set<T extends CacheableValue>(entry: CacheEntry<T>): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO portfolio_market_data_cache
         (cache_key, provider, endpoint, symbol, interval, provider_timestamp, fetched_at, expires_at, stale_until, payload, payload_bytes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (cache_key) DO UPDATE SET
           provider = EXCLUDED.provider,
           endpoint = EXCLUDED.endpoint,
           symbol = EXCLUDED.symbol,
           interval = EXCLUDED.interval,
           provider_timestamp = EXCLUDED.provider_timestamp,
           fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at,
           stale_until = EXCLUDED.stale_until,
           payload = EXCLUDED.payload,
           payload_bytes = EXCLUDED.payload_bytes,
           updated_at = now()`,
        [entry.key, entry.provenance.provider, entry.provenance.endpoint, entry.provenance.symbol === "*" ? null : entry.provenance.symbol, entry.provenance.interval, entry.providerTimestamp, new Date(entry.fetchedAt), new Date(entry.expiresAt), new Date(entry.staleUntil), JSON.stringify(entry.value), entry.bytes],
      );
    } catch {
      return;
    }
  }
  async pruneExpired(input: { olderThan?: Date; limit?: number } = {}): Promise<number> {
    try {
      const olderThan = input.olderThan ?? new Date(Date.now() - 86_400_000);
      const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit ?? 1_000)));
      const result = await this.pool.query(
        `DELETE FROM portfolio_market_data_cache
         WHERE cache_key IN (
           SELECT cache_key
           FROM portfolio_market_data_cache
           WHERE stale_until < $1
           ORDER BY stale_until ASC
           LIMIT $2
         )`,
        [olderThan, limit],
      );
      this.lastPrunedAt = Date.now();
      return result.rowCount ?? 0;
    } catch {
      return 0;
    }
  }
  shouldPrune(intervalMs: number) {
    return Date.now() - this.lastPrunedAt >= intervalMs;
  }
}

export function createPortfolioMarketDataProvider(kind: PortfolioMarketDataProviderKind, config?: PortfolioConfig): PortfolioMarketDataProvider {
  if (kind === "fixture") return new FixturePortfolioMarketDataProvider();
  if (kind === "none") return new NoPortfolioMarketDataProvider();
  if (!config) throw new Error("PortfolioConfig is required for production Portfolio market data.");
  const configuredProviders = (config.marketDataProviders ?? [kind]).filter((provider) => provider !== "none");
  const providers = configuredProviders.map((provider) => instantiateProvider(provider, config));
  return new PortfolioMarketDataRouter(providers.length ? providers : [instantiateProvider(kind, config)], config, process.env.NODE_ENV === "production", process.env.DATABASE_URL ? new PgPortfolioMarketDataCache() : null);
}

export class PortfolioMarketDataRouter implements PortfolioMarketDataProvider {
  id = "portfolio-market-data-router";
  private readonly cache: PortfolioMarketDataCache;
  private readonly providerLimiter: AsyncLimiter;
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();
  private readonly providerCooldownUntil = new Map<string, number>();
  private readonly symbolsRequested = new Set<string>();
  private readonly providerRequestKeys = new Set<string>();
  private readonly telemetryCounters = {
    portfolioMarketDataRequests: 0, portfolioProviderRequests: 0, cacheHits: 0, cacheMisses: 0, inFlightCoalescedRequests: 0, providerCallsAvoided: 0,
    cacheFreshHits: 0, cacheStaleHits: 0, providerRateLimitEvents: 0,
    providerCallsByProvider: {} as Record<string, number>, providerCallsByEndpoint: {} as Record<string, number>, providerCreditsUsed: {} as Record<string, number>, providerCreditsRemaining: {} as Record<string, number>,
  };
  constructor(private readonly providers: PortfolioMarketDataProvider[], private readonly config: Partial<Pick<PortfolioConfig, "cacheEnabled" | "cacheMaxEntries" | "cacheMaxBytes" | "cachePruneIntervalMs" | "cacheExpiredRetentionMs" | "providerMaxConcurrency" | "providerRateLimitCooldownMs">> = { cacheEnabled: true, cacheMaxEntries: 2_000, cacheMaxBytes: null, providerMaxConcurrency: 8, providerRateLimitCooldownMs: 300_000 }, private readonly production = process.env.NODE_ENV === "production", private readonly durableCache: DurablePortfolioMarketDataCache | null = null, private readonly blockers: OperationalBlockerService = operationalBlockerService) {
    this.cache = new PortfolioMarketDataCache(config.cacheMaxEntries ?? 2_000, config.cacheMaxBytes ?? null);
    this.providerLimiter = new AsyncLimiter(config.providerMaxConcurrency ?? 8);
  }
  capabilities() {
    const usable = this.usableProviders();
    return { assetClasses: unique(usable.flatMap((provider) => provider.capabilities().assetClasses)), capabilities: unique(usable.flatMap((provider) => provider.capabilities().capabilities)), fixture: false, live: usable.some((provider) => provider.capabilities().live), historical: usable.some((provider) => provider.capabilities().historical), latestQuote: usable.some((provider) => provider.capabilities().latestQuote), search: usable.some((provider) => provider.capabilities().search), marketStatus: usable.some((provider) => provider.capabilities().marketStatus), options: usable.some((provider) => provider.capabilities().options) };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()) {
    const endpoint = "quote";
    return this.resolve({ endpoint, capability: "QUOTE", assetClass, cacheKey: { provider: "*", endpoint, symbol: symbol.toUpperCase(), assetClass, interval: "latest" }, ttl: ttlFor({ endpoint, interval: "latest", now }), now, fetcher: (provider) => provider.getQuote(symbol, assetClass, now) });
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: PortfolioHistoricalRequest = {}) {
    const endpoint = "time_series";
    const interval = input.interval ?? "1day";
    const now = input.now ?? new Date();
    return this.resolve({ endpoint, capability: "HISTORICAL_OHLCV", assetClass, cacheKey: { provider: "*", endpoint, symbol: symbol.toUpperCase(), assetClass, interval, timezone: input.timezone ?? "UTC", adjusted: input.adjusted ?? true, outputSize: input.outputSize ?? "compact", startDate: input.startDate ?? null, endDate: input.endDate ?? null }, ttl: historicalTtlFor({ interval, now, endDate: input.endDate }), now, fetcher: (provider) => {
      if (!provider.getHistoricalBars) throw providerError("capability_unavailable", "Historical OHLCV unavailable.");
      return provider.getHistoricalBars(symbol, assetClass, input);
    } });
  }
  async searchInstruments(keywords: string) {
    const endpoint = "symbol_search";
    return this.resolve({ endpoint, capability: "INSTRUMENT_SEARCH", cacheKey: { provider: "*", endpoint, symbol: keywords.toLowerCase(), interval: "reference" }, ttl: { expiresInMs: 6 * 3_600_000, staleForMs: 24 * 3_600_000 }, now: new Date(), fetcher: (provider) => {
      if (!provider.searchInstruments) throw providerError("capability_unavailable", "Instrument search unavailable.");
      return provider.searchInstruments(keywords);
    } });
  }
  async getMarketStatus(now = new Date()) {
    const endpoint = "market_status";
    return this.resolve({ endpoint, capability: "MARKET_STATUS", cacheKey: { provider: "*", endpoint, interval: "reference" }, ttl: { expiresInMs: 60_000, staleForMs: 300_000 }, now, fetcher: (provider) => {
      if (!provider.getMarketStatus) throw providerError("capability_unavailable", "Market status unavailable.");
      return provider.getMarketStatus(now);
    } });
  }
  async getOptionChain(underlying: string, input: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date } = {}) {
    const endpoint = input.historicalDate ? "historical_options" : "realtime_options";
    return this.resolve({ endpoint, capability: "OPTIONS_CHAIN", assetClass: "option", cacheKey: { provider: "*", endpoint, symbol: underlying.toUpperCase(), assetClass: "option", interval: input.historicalDate ? "historical" : "latest", expiration: input.expiration ?? null, contract: input.contract ?? null, historicalDate: input.historicalDate ?? null, requireGreeks: input.requireGreeks ?? null }, ttl: ttlFor({ endpoint, interval: input.historicalDate ? "1day" : "latest", now: input.now ?? new Date() }), now: input.now ?? new Date(), fetcher: (provider) => {
      if (!provider.getOptionChain) throw providerError("capability_unavailable", "Options chain unavailable.");
      return provider.getOptionChain(underlying, input);
    } });
  }
  providerFor(capability: PortfolioMarketDataCapability, assetClass?: AssetClass) {
    const provider = this.usableProviders().find((candidate) => supports(candidate, capability, assetClass));
    if (!provider) throw providerError("capability_unavailable", `No real provider is configured for ${capability}${assetClass ? `/${assetClass}` : ""}.`);
    return provider;
  }
  telemetry(): PortfolioMarketDataTelemetry {
    return { ...this.telemetryCounters, cacheEntries: this.cache.size(), cacheEvictions: this.cache.evictionsCount(), cacheHitRate: this.telemetryCounters.portfolioMarketDataRequests ? Number((this.telemetryCounters.cacheHits / this.telemetryCounters.portfolioMarketDataRequests).toFixed(4)) : 0, uniqueSymbolsRequested: this.symbolsRequested.size, uniqueProviderRequests: this.providerRequestKeys.size };
  }
  health() {
    const providerHealth = this.usableProviders().map((provider) => provider.health?.() ?? { provider: provider.id, quotaState: "healthy" as const, lastSuccessfulRefresh: {}, creditsUsed: null, creditsRemaining: null });
    return { provider: this.id, quotaState: providerHealth.some((item) => item.quotaState === "healthy") ? "healthy" as const : providerHealth[0]?.quotaState ?? "provider_unavailable" as const, lastSuccessfulRefresh: Object.assign({}, ...providerHealth.map((item) => item.lastSuccessfulRefresh)), creditsUsed: null, creditsRemaining: null, providers: providerHealth, telemetry: this.telemetry() };
  }
  async pruneDurableCache(now = new Date()) {
    if (!this.durableCache?.pruneExpired) return { pruned: 0, durable: false };
    const olderThan = new Date(now.getTime() - (this.config.cacheExpiredRetentionMs ?? 86_400_000));
    const pruned = await this.durableCache.pruneExpired({ olderThan, limit: 1_000 });
    return { pruned, durable: true };
  }
  private async resolve<T extends CacheableValue>(input: { endpoint: string; capability: PortfolioMarketDataCapability; assetClass?: AssetClass; cacheKey: CacheKeyInput; ttl: { expiresInMs: number; staleForMs: number }; now: Date; fetcher: ProviderFetch<T> }): Promise<T> {
    this.telemetryCounters.portfolioMarketDataRequests += 1;
    if (input.cacheKey.symbol) this.symbolsRequested.add(input.cacheKey.symbol);
    const candidates = this.usableProviders().filter((provider) => supports(provider, input.capability, input.assetClass));
    let staleEntry: CacheEntry<T> | null = null;
    if (this.cacheEnabled()) {
      for (const provider of candidates) {
        const key = marketDataCacheKey({ ...input.cacheKey, provider: provider.id });
        const cached = this.cache.get<T>(key, input.now.getTime());
        if (cached?.freshnessState === "fresh") {
          this.telemetryCounters.cacheHits += 1;
          this.telemetryCounters.cacheFreshHits += 1;
          this.telemetryCounters.providerCallsAvoided += 1;
          return withProvenance(cached.entry.value, cached.entry, "hit", "fresh");
        }
        if (!staleEntry && cached?.freshnessState === "stale_revalidating") staleEntry = cached.entry;
        if (!cached && this.durableCache && durableEligible(input.endpoint)) {
          const durable = await this.durableCache.get<T>(key);
          if (durable) {
            this.cache.set(durable);
            const freshnessState: PortfolioMarketDataFreshnessState = input.now.getTime() <= durable.expiresAt ? "fresh" : "stale_revalidating";
            this.telemetryCounters.cacheHits += 1;
            this.telemetryCounters.cacheFreshHits += freshnessState === "fresh" ? 1 : 0;
            this.telemetryCounters.cacheStaleHits += freshnessState === "stale_revalidating" ? 1 : 0;
            this.telemetryCounters.providerCallsAvoided += 1;
            return withProvenance(durable.value, durable, freshnessState === "fresh" ? "hit" : "stale_hit", freshnessState);
          }
        }
      }
      if (staleEntry) {
        this.telemetryCounters.cacheHits += 1;
        this.telemetryCounters.cacheStaleHits += 1;
        this.telemetryCounters.providerCallsAvoided += 1;
        void this.backgroundRefresh(staleEntry.key, input);
        return withProvenance(staleEntry.value, staleEntry, "stale_hit", "stale_revalidating");
      }
    }
    let failedPrimary: { provider: string; code: string; message: string } | null = null;
    for (const provider of candidates) {
      if (this.providerOnCooldown(provider, input.now)) continue;
      const key = marketDataCacheKey({ ...input.cacheKey, provider: provider.id });
      const result = await this.fetchWithCoalescing(key, provider, input);
      if (result.entry) {
        if (failedPrimary && provider.id !== failedPrimary.provider) {
          result.entry.provenance.dataKind = "REAL_PROVIDER_FALLBACK";
          await this.recordFallbackIncident(input, failedPrimary, provider.id);
        }
        return withProvenance(result.entry.value as T, result.entry as CacheEntry<T>, result.entry.provenance.cacheStatus, "fresh");
      }
      if (!failedPrimary) failedPrimary = { provider: provider.id, code: result.errorCode ?? "provider_failure", message: result.errorMessage ?? "provider failed" };
    }
    await this.recordMarketDataUnavailable(input, failedPrimary);
    throw providerError("capability_unavailable", `No configured provider returned ${input.endpoint}.`);
  }
  private async fetchWithCoalescing<T extends CacheableValue>(key: string, provider: PortfolioMarketDataProvider, input: { endpoint: string; ttl: { expiresInMs: number; staleForMs: number }; now: Date; fetcher: ProviderFetch<T> }) {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.telemetryCounters.inFlightCoalescedRequests += 1;
      this.telemetryCounters.providerCallsAvoided += 1;
      try {
        const entry = await existing;
        return { entry: { ...entry, provenance: { ...entry.provenance, cacheStatus: "coalesced" as const } } };
      } catch (error) {
        return { entry: null, errorCode: String((error as { code?: unknown }).code ?? "provider_failure"), errorMessage: error instanceof Error ? error.message : String(error) };
      }
    }
    this.telemetryCounters.cacheMisses += 1;
    const request = (async () => {
      this.telemetryCounters.portfolioProviderRequests += 1;
      increment(this.telemetryCounters.providerCallsByProvider, provider.id);
      increment(this.telemetryCounters.providerCallsByEndpoint, input.endpoint);
      this.providerRequestKeys.add(`${provider.id}:${input.endpoint}:${key}`);
      const value = await this.providerLimiter.run(() => input.fetcher(provider));
      const providerTimestamp = latestTimestamp(value);
      const fetchedAt = input.now.getTime();
      const entry: CacheEntry<T> = { key, value, bytes: byteSize(value), fetchedAt, expiresAt: fetchedAt + input.ttl.expiresInMs, staleUntil: fetchedAt + input.ttl.expiresInMs + input.ttl.staleForMs, providerTimestamp, provenance: { provider: provider.id, symbol: symbolFromValue(value), endpoint: input.endpoint, interval: intervalFromKey(key), providerTimestamp, fetchedAt: new Date(fetchedAt).toISOString(), expiresAt: new Date(fetchedAt + input.ttl.expiresInMs).toISOString(), staleUntil: new Date(fetchedAt + input.ttl.expiresInMs + input.ttl.staleForMs).toISOString(), cacheStatus: "miss" } };
      const health = provider.health?.();
      if (health?.creditsUsed !== null && health?.creditsUsed !== undefined) this.telemetryCounters.providerCreditsUsed[provider.id] = health.creditsUsed;
      if (health?.creditsRemaining !== null && health?.creditsRemaining !== undefined) this.telemetryCounters.providerCreditsRemaining[provider.id] = health.creditsRemaining;
      if (health?.quotaState === "rate_limited" || health?.quotaState === "waiting_for_quota") this.telemetryCounters.providerRateLimitEvents += 1;
      entry.provenance.apiCreditsUsed = health?.creditsUsed ?? null;
      entry.provenance.apiCreditsLeft = health?.creditsRemaining ?? null;
      if (this.cacheEnabled()) this.cache.set(entry);
      if (this.durableCache && durableEligible(input.endpoint)) {
        void this.durableCache.set(entry);
        if (this.durableCache instanceof PgPortfolioMarketDataCache && this.durableCache.shouldPrune(this.config.cachePruneIntervalMs ?? 3_600_000)) {
          void this.pruneDurableCache(input.now);
        }
      }
      return entry;
    })();
    this.inFlight.set(key, request as Promise<CacheEntry>);
    try {
      return { entry: await request };
    } catch (error) {
      if (isRateLimitError(error)) {
        this.telemetryCounters.providerRateLimitEvents += 1;
        this.providerCooldownUntil.set(provider.id, input.now.getTime() + (this.config.providerRateLimitCooldownMs ?? 300_000));
      }
      return { entry: null, errorCode: String((error as { code?: unknown }).code ?? "provider_failure"), errorMessage: error instanceof Error ? error.message : String(error) };
    } finally {
      this.inFlight.delete(key);
    }
  }
  private async backgroundRefresh<T extends CacheableValue>(key: string, input: { endpoint: string; capability: PortfolioMarketDataCapability; assetClass?: AssetClass; ttl: { expiresInMs: number; staleForMs: number }; now: Date; fetcher: ProviderFetch<T> }) {
    if (this.inFlight.has(key)) return;
    const cachedProvider = key.split("|")[1];
    const provider = this.usableProviders().find((candidate) => candidate.id === cachedProvider && supports(candidate, input.capability, input.assetClass) && !this.providerOnCooldown(candidate, input.now))
      ?? this.usableProviders().find((candidate) => supports(candidate, input.capability, input.assetClass) && !this.providerOnCooldown(candidate, input.now));
    if (!provider) return;
    await this.fetchWithCoalescing(key, provider, input).catch(() => null);
  }
  private async recordFallbackIncident(input: { endpoint: string; cacheKey: CacheKeyInput; now: Date }, failedPrimary: { provider: string; code: string; message: string }, fallbackProvider: string) {
    await this.blockers.record({
      kind: "fallback",
      code: "market_data_provider_fallback_active",
      title: "Market-data provider fallback active",
      whatBlocked: "primary Portfolio market-data provider",
      reason: `${failedPrimary.provider} failed with ${failedPrimary.code}`,
      currentValue: { primary: failedPrimary.provider, fallback: fallbackProvider, reason: failedPrimary.code },
      limitValue: "primary provider healthy",
      scope: { symbol: input.cacheKey.symbol, component: `${failedPrimary.provider}->${fallbackProvider}` },
      expected: false,
      action: "Review provider quota, authentication, and reachability; fallback data remains real provider data.",
      effect: `Portfolio ${input.endpoint} is using ${fallbackProvider} instead of ${failedPrimary.provider}.`,
      severity: "warning",
      alertCategory: "MARKET_DATA_FALLBACK",
      now: input.now,
    });
  }
  private async recordMarketDataUnavailable(input: { endpoint: string; cacheKey: CacheKeyInput; now: Date }, failure: { provider: string; code: string; message: string } | null) {
    await this.blockers.record({
      kind: "dependency",
      code: "required_market_data_unavailable",
      title: "Required real market data unavailable",
      whatBlocked: `Portfolio ${input.endpoint}`,
      reason: failure ? `${failure.provider} failed with ${failure.code}` : "no configured real provider supports this request",
      currentValue: failure ? { provider: failure.provider, reason: failure.code } : "NO_PROVIDER",
      limitValue: "fresh or explicitly stale real provider data",
      scope: { symbol: input.cacheKey.symbol, component: failure?.provider },
      expected: false,
      action: "Restore a configured real market-data provider; fixture or simulated fallback is prohibited for execution-capable workflows.",
      effect: "Portfolio workflow is blocked/degraded rather than silently using fabricated data.",
      severity: "critical",
      alertCategory: "MARKET_DATA_FAILURE",
      now: input.now,
    });
  }
  private providerOnCooldown(provider: PortfolioMarketDataProvider, now: Date) {
    return (this.providerCooldownUntil.get(provider.id) ?? 0) > now.getTime();
  }
  private cacheEnabled() { return this.config.cacheEnabled !== false; }
  private usableProviders() { return this.providers.filter((provider) => !(this.production && provider.capabilities().fixture)); }
}

export function marketDataCacheKey(input: CacheKeyInput) {
  return [
    "portfolio-md", input.provider, input.endpoint, input.symbol ?? "*", input.assetClass ?? "*", input.interval ?? "*", input.exchange ?? "*",
    input.timezone ?? "*", input.adjusted === null || input.adjusted === undefined ? "*" : input.adjusted ? "adjusted" : "raw",
    input.outputSize ?? "*", input.startDate ?? "*", input.endDate ?? "*", input.expiration ?? "*", input.contract ?? "*", input.historicalDate ?? "*",
    input.requireGreeks === null || input.requireGreeks === undefined ? "*" : input.requireGreeks ? "greeks" : "no-greeks",
  ].join("|").toLowerCase();
}

class AsyncLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }
  private async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private release() {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}

function instantiateProvider(kind: PortfolioMarketDataProviderKind, config: PortfolioConfig) {
  if (kind === "twelve_data") return new TwelveDataPortfolioMarketDataProvider(config);
  if (kind === "alpha_vantage") return new AlphaVantagePortfolioMarketDataProvider(config);
  if (kind === "fixture") return new FixturePortfolioMarketDataProvider();
  return new NoPortfolioMarketDataProvider();
}

function ttlFor(input: { endpoint: string; interval: string; now: Date }) {
  if (input.endpoint === "quote" || input.interval === "latest") return { expiresInMs: usEquityMarketOpen(input.now) ? 10_000 : 15 * 60_000, staleForMs: 60_000 };
  if (input.interval === "1min") return boundaryTtl(input.now, 1, 3_000);
  if (input.interval === "5min") return boundaryTtl(input.now, 5, 5_000);
  if (input.interval === "15min") return boundaryTtl(input.now, 15, 10_000);
  if (input.interval === "30min") return boundaryTtl(input.now, 30, 15_000);
  if (input.interval === "60min") return boundaryTtl(input.now, 60, 30_000);
  if (input.interval === "1day") return { expiresInMs: msUntilNextDailyCompletion(input.now), staleForMs: 6 * 3_600_000 };
  return { expiresInMs: 60_000, staleForMs: 300_000 };
}

function historicalTtlFor(input: { interval: string; now: Date; endDate?: string }) {
  if (input.endDate && historicalRangeClosed(input.endDate, input.now)) {
    return { expiresInMs: 7 * 86_400_000, staleForMs: 30 * 86_400_000 };
  }
  return ttlFor({ endpoint: "time_series", interval: input.interval, now: input.now });
}

function historicalRangeClosed(endDate: string, now: Date) {
  const parsed = Date.parse(endDate.includes("T") ? endDate : `${endDate}T23:59:59.999Z`);
  if (!Number.isFinite(parsed)) return false;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return parsed < today.getTime();
}

function boundaryTtl(now: Date, minutes: number, graceMs: number) {
  const intervalMs = minutes * 60_000;
  const next = Math.ceil(now.getTime() / intervalMs) * intervalMs + graceMs;
  return { expiresInMs: Math.max(1_000, next - now.getTime()), staleForMs: intervalMs };
}

function msUntilNextDailyCompletion(now: Date) {
  const close = new Date(now);
  close.setUTCHours(21, 5, 0, 0);
  if (now.getTime() >= close.getTime()) close.setUTCDate(close.getUTCDate() + 1);
  while (close.getUTCDay() === 0 || close.getUTCDay() === 6) close.setUTCDate(close.getUTCDate() + 1);
  return Math.max(60_000, close.getTime() - now.getTime());
}

function withProvenance<T extends CacheableValue>(value: T, entry: CacheEntry<T>, cacheStatus: PortfolioMarketDataProvenance["cacheStatus"], freshnessState: PortfolioMarketDataFreshnessState): T {
  const provenance = { ...entry.provenance, cacheStatus, freshnessState };
  if (Array.isArray(value)) return value.map((item) => attachProvenance(item, provenance, freshnessState)) as T;
  return attachProvenance(value, provenance, freshnessState) as T;
}

function attachProvenance<T>(value: T, provenance: PortfolioMarketDataProvenance, freshnessState: PortfolioMarketDataFreshnessState): T {
  if (!value || typeof value !== "object") return value;
  return { ...(value as Record<string, unknown>), stale: freshnessState !== "fresh" || Boolean((value as { stale?: boolean }).stale), marketData: provenance } as T;
}

function supports(provider: PortfolioMarketDataProvider, capability: PortfolioMarketDataCapability, assetClass?: AssetClass) {
  const capabilities = provider.capabilities();
  return capabilities.capabilities.includes(capability) && (!assetClass || capabilities.assetClasses.includes(assetClass));
}

function latestTimestamp(value: CacheableValue): string | null {
  const items = Array.isArray(value) ? value : [value];
  const timestamps = items.map((item) => (item as { observedAt?: string }).observedAt).filter(Boolean).sort();
  return timestamps.at(-1) ?? null;
}
function symbolFromValue(value: CacheableValue) {
  const item = Array.isArray(value) ? value[0] : value;
  return String((item as { symbol?: unknown; underlying?: unknown }).symbol ?? (item as { underlying?: unknown }).underlying ?? "*");
}
function intervalFromKey(key: string) { return key.split("|")[5] ?? null; }
function byteSize(value: unknown) { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
function increment(record: Record<string, number>, key: string) { record[key] = (record[key] ?? 0) + 1; }
function durableEligible(endpoint: string) { return endpoint !== "quote" && endpoint !== "realtime_options"; }

function instrument(symbol: string, displayName: string, assetClass: AssetClass, provider: string, extra: Partial<PortfolioInstrument> = {}): PortfolioInstrument {
  return { instrumentId: `${provider}:${symbol}`, symbol, displayName, assetClass, subtype: null, exchange: null, currency: "USD", country: null, sector: null, industry: null, marketCalendar: "US_EQUITY", tickSize: 0.01, lotSize: assetClass === "option" ? 1 : 0.000001, contractMultiplier: assetClass === "option" ? 100 : null, underlying: null, optionStrike: null, optionExpiration: null, optionType: null, bondMaturity: null, coupon: null, providerMappings: { [provider]: symbol }, benchmarkEligible: ["equity", "etf", "index_proxy"].includes(assetClass), status: "active", ...extra };
}
function classifyAsset(type: string): AssetClass { if (/etf|fund/i.test(type)) return "etf"; return "equity"; }
function usEquityMarketOpen(now: Date) { const day = now.getUTCDay(); if (day === 0 || day === 6) return false; const minutes = now.getUTCHours() * 60 + now.getUTCMinutes(); return minutes >= 14 * 60 + 30 && minutes < 21 * 60; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function requiredNumber(value: unknown, label: string) { const parsed = number(value); if (parsed === null) throw providerError("malformed_response", `Provider response missing ${label}.`); return parsed; }
function headerNumber(response: Response, name: string) { const value = response.headers?.get?.(name); return value === null || value === undefined ? null : number(value); }
function providerTimestamp(value: unknown, now: Date) {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const text = string(value);
  if (!text) return now.toISOString();
  const parsed = Date.parse(text.includes("T") ? text : `${text}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : now.toISOString();
}
function errorCodeFromTwelveData(code: unknown) {
  const numeric = Number(code);
  if (numeric === 429 || numeric === 120) return "rate_limited";
  if (numeric === 401 || numeric === 403) return "authentication_error";
  if (numeric === 404) return "unsupported_symbol";
  return "provider_error";
}
export function providerError(code: string, message: string) { const error = new Error(message) as Error & { code: string }; error.code = code; return error; }
function isRateLimitError(error: unknown) {
  return /rate_limited|quota|provider_budget_exhausted/.test(String((error as { code?: string }).code ?? error));
}

function mapAlphaOption(row: Record<string, unknown>, underlying: string, source: string, now: Date): PortfolioOptionContract {
  const expiration = string(row.expiration) || string(row.expirationDate);
  const contractId = string(row.contractID) || string(row.contract) || string(row.symbol);
  const typeValue = string(row.type || row.option_type || row.optionType).toLowerCase();
  if (!contractId || !expiration) throw providerError("malformed_response", "Option contract response missing contract ID or expiration.");
  return { contractId, underlying, optionType: typeValue === "put" ? "put" : "call", strike: requiredNumber(row.strike, `option strike ${contractId}`), expiration, multiplier: 100, bid: number(row.bid), ask: number(row.ask), last: number(row.last) ?? number(row.mark), volume: number(row.volume), openInterest: number(row.open_interest ?? row.openInterest), impliedVolatility: number(row.implied_volatility ?? row.impliedVolatility), observedAt: now.toISOString(), lifecycle: optionLifecycle(expiration, now), source, fixture: false };
}
function optionLifecycle(expiration: string, now: Date): PortfolioOptionContract["lifecycle"] { const expiry = Date.parse(`${expiration}T21:00:00.000Z`); if (!Number.isFinite(expiry)) return "ACTIVE"; if (now.getTime() > expiry) return "EXPIRED"; if (expiry - now.getTime() <= 3 * 86_400_000) return "EXPIRING"; return "ACTIVE"; }
function unique<T>(values: T[]) { return [...new Set(values)]; }
