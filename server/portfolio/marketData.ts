import type { AssetClass, PortfolioHistoricalBar, PortfolioInstrument, PortfolioMarketDataCapability, PortfolioMarketStatus, PortfolioOptionContract, PortfolioQuote } from "./domain";
import type { PortfolioConfig } from "./config";

export type PortfolioMarketDataProvider = {
  id: string;
  capabilities(): { assetClasses: AssetClass[]; capabilities: PortfolioMarketDataCapability[]; fixture: boolean; live: boolean; historical: boolean; latestQuote: boolean; search: boolean; marketStatus: boolean; options: boolean };
  getQuote(symbol: string, assetClass: AssetClass, now?: Date): Promise<PortfolioQuote>;
  getHistoricalBars?(symbol: string, assetClass: AssetClass, input?: { outputSize?: "compact" | "full"; now?: Date }): Promise<PortfolioHistoricalBar[]>;
  searchInstruments?(keywords: string): Promise<PortfolioInstrument[]>;
  getMarketStatus?(now?: Date): Promise<PortfolioMarketStatus[]>;
  getOptionChain?(underlying: string, input?: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date }): Promise<PortfolioOptionContract[]>;
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
    return { assetClasses: ["equity", "etf", "bond", "index_proxy", "commodity", "fx", "option"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "MARKET_STATUS"] as PortfolioMarketDataCapability[], fixture: true, live: false, historical: true, latestQuote: true, search: true, marketStatus: true, options: false };
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

  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: { now?: Date } = {}) {
    const quote = await this.getQuote(symbol, assetClass, input.now);
    return Array.from({ length: 60 }, (_, index): PortfolioHistoricalBar => {
      const date = new Date(Date.parse(quote.observedAt) - (59 - index) * 86_400_000);
      const drift = 1 + (index - 30) * 0.0005;
      const close = Number((quote.last * drift).toFixed(4));
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

  capabilities() {
    return { assetClasses: [] as AssetClass[], capabilities: [] as PortfolioMarketDataCapability[], fixture: false, live: false, historical: false, latestQuote: false, search: false, marketStatus: false, options: false };
  }

  async getQuote(symbol: string): Promise<PortfolioQuote> {
    throw new Error(`portfolio_market_data_unavailable:${symbol}`);
  }
}

export class AlphaVantagePortfolioMarketDataProvider implements PortfolioMarketDataProvider {
  id = "alpha-vantage";
  private calls = 0;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(private readonly config: Pick<PortfolioConfig, "alphaVantageApiKey" | "providerCallBudget" | "providerTimeoutMs" | "providerCacheTtlMs" | "quoteFreshnessMaxMinutes">, private readonly fetchImpl: typeof fetch = fetch) {
    if (!config.alphaVantageApiKey?.trim()) throw new Error("ALPHA_VANTAGE_API_KEY is required for Alpha Vantage Portfolio market data.");
  }

  capabilities() {
    return { assetClasses: ["equity", "etf", "index_proxy", "option"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV", "INSTRUMENT_SEARCH", "REFERENCE_DATA", "CORPORATE_ACTIONS", "OPTIONS_CHAIN", "OPTION_QUOTES", "MARKET_STATUS", "INDEX_DATA", "ETF_DATA"] as PortfolioMarketDataCapability[], fixture: false, live: true, historical: true, latestQuote: true, search: true, marketStatus: true, options: true };
  }

  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    this.requireSupported(assetClass);
    const data = await this.query("GLOBAL_QUOTE", { symbol: symbol.toUpperCase() }, `quote:${symbol.toUpperCase()}`);
    const quote = object(data["Global Quote"]);
    const price = number(quote["05. price"]);
    const tradingDay = string(quote["07. latest trading day"]);
    if (!price || !tradingDay) throw providerError("malformed_response", `Alpha Vantage quote for ${symbol} did not include price/trading day.`);
    const observedAt = new Date(`${tradingDay}T21:00:00.000Z`).toISOString();
    return { symbol: symbol.toUpperCase(), assetClass, bid: null, ask: null, last: price, currency: "USD", observedAt, stale: now.getTime() - Date.parse(observedAt) > this.config.quoteFreshnessMaxMinutes * 60_000, source: this.id, fixture: false };
  }

  async getHistoricalBars(symbol: string, assetClass: AssetClass, input: { outputSize?: "compact" | "full"; now?: Date } = {}): Promise<PortfolioHistoricalBar[]> {
    this.requireSupported(assetClass);
    const data = await this.query("TIME_SERIES_DAILY_ADJUSTED", { symbol: symbol.toUpperCase(), outputsize: input.outputSize ?? "compact" }, `daily:${symbol.toUpperCase()}:${input.outputSize ?? "compact"}`);
    const series = object(data["Time Series (Daily)"]);
    const rows = Object.entries(series).map(([date, value]) => {
      const row = object(value);
      const close = requiredNumber(row["4. close"], `daily close ${symbol} ${date}`);
      return {
        symbol: symbol.toUpperCase(),
        assetClass,
        open: requiredNumber(row["1. open"], `daily open ${symbol} ${date}`),
        high: requiredNumber(row["2. high"], `daily high ${symbol} ${date}`),
        low: requiredNumber(row["3. low"], `daily low ${symbol} ${date}`),
        close,
        adjustedClose: number(row["5. adjusted close"]),
        volume: requiredNumber(row["6. volume"], `daily volume ${symbol} ${date}`),
        dividendAmount: number(row["7. dividend amount"]),
        splitCoefficient: number(row["8. split coefficient"]),
        observedAt: new Date(`${date}T21:00:00.000Z`).toISOString(),
        source: this.id,
        fixture: false,
      } satisfies PortfolioHistoricalBar;
    }).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!rows.length) throw providerError("malformed_response", `Alpha Vantage historical data for ${symbol} was empty.`);
    return rows;
  }

  async searchInstruments(keywords: string): Promise<PortfolioInstrument[]> {
    const data = await this.query("SYMBOL_SEARCH", { keywords }, `search:${keywords.toLowerCase()}`);
    const matches = Array.isArray(data.bestMatches) ? data.bestMatches : [];
    return matches.map((item: unknown) => {
      const row = object(item);
      const symbol = string(row["1. symbol"]) || "UNKNOWN";
      return instrument(symbol, string(row["2. name"]) || symbol, classifyAsset(string(row["3. type"])), this.id, { exchange: string(row["4. region"]) || null, currency: "USD", country: string(row["4. region"]) || null });
    });
  }

  async getMarketStatus(now = new Date()): Promise<PortfolioMarketStatus[]> {
    const data = await this.query("MARKET_STATUS", {}, "market-status");
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
    const data = await this.query(functionName, params, `options:${functionName}:${underlying.toUpperCase()}:${input.expiration ?? "all"}:${input.contract ?? "all"}:${input.historicalDate ?? "current"}:${input.requireGreeks ? "greeks" : "nogreeks"}`);
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.options) ? data.options : [];
    return rows.map((item: unknown) => mapAlphaOption(object(item), underlying.toUpperCase(), this.id, input.now ?? new Date()));
  }

  private requireSupported(assetClass: AssetClass) {
    if (assetClass === "option") throw providerError("unsupported_asset", "Use getOptionChain for option contracts.");
    if (!this.capabilities().assetClasses.includes(assetClass)) throw providerError("unsupported_asset", `Alpha Vantage provider does not support ${assetClass} in Portfolio mode.`);
  }

  private async query(functionName: string, params: Record<string, string>, cacheKey: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as Record<string, unknown>;
    if (this.calls >= this.config.providerCallBudget) throw providerError("provider_budget_exhausted", "Portfolio Alpha Vantage provider call budget exhausted.");
    this.calls += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.providerTimeoutMs);
    try {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", functionName);
      url.searchParams.set("apikey", this.config.alphaVantageApiKey!);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw providerError(response.status === 429 ? "rate_limited" : "http_error", `Alpha Vantage request failed with HTTP ${response.status}.`);
      const data = await response.json() as Record<string, unknown>;
      if (data["Error Message"]) throw providerError("provider_error", String(data["Error Message"]));
      if (data.Note || data.Information) throw providerError("rate_limited", String(data.Note ?? data.Information));
      this.cache.set(cacheKey, { value: data, expiresAt: Date.now() + this.config.providerCacheTtlMs });
      return data;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw providerError("timeout", "Alpha Vantage request timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createPortfolioMarketDataProvider(kind: "alpha_vantage" | "fixture" | "none", config?: PortfolioConfig): PortfolioMarketDataProvider {
  if (kind === "alpha_vantage") {
    if (!config) throw new Error("PortfolioConfig is required for Alpha Vantage market data.");
    return new PortfolioMarketDataRouter([new AlphaVantagePortfolioMarketDataProvider(config)]);
  }
  return kind === "fixture" ? new FixturePortfolioMarketDataProvider() : new NoPortfolioMarketDataProvider();
}

export class PortfolioMarketDataRouter implements PortfolioMarketDataProvider {
  id = "portfolio-market-data-router";
  constructor(private readonly providers: PortfolioMarketDataProvider[], private readonly production = process.env.NODE_ENV === "production") {}

  capabilities() {
    const usable = this.usableProviders();
    return {
      assetClasses: unique(usable.flatMap((provider) => provider.capabilities().assetClasses)),
      capabilities: unique(usable.flatMap((provider) => provider.capabilities().capabilities)),
      fixture: false,
      live: usable.some((provider) => provider.capabilities().live),
      historical: usable.some((provider) => provider.capabilities().historical),
      latestQuote: usable.some((provider) => provider.capabilities().latestQuote),
      search: usable.some((provider) => provider.capabilities().search),
      marketStatus: usable.some((provider) => provider.capabilities().marketStatus),
      options: usable.some((provider) => provider.capabilities().options),
    };
  }

  async getQuote(symbol: string, assetClass: AssetClass, now?: Date) {
    return this.providerFor("QUOTE", assetClass).getQuote(symbol, assetClass, now);
  }

  async getHistoricalBars(symbol: string, assetClass: AssetClass, input?: { outputSize?: "compact" | "full"; now?: Date }) {
    const provider = this.providerFor("HISTORICAL_OHLCV", assetClass);
    if (!provider.getHistoricalBars) throw providerError("capability_unavailable", "Historical OHLCV unavailable.");
    return provider.getHistoricalBars(symbol, assetClass, input);
  }

  async searchInstruments(keywords: string) {
    const provider = this.providerFor("INSTRUMENT_SEARCH");
    if (!provider.searchInstruments) throw providerError("capability_unavailable", "Instrument search unavailable.");
    return provider.searchInstruments(keywords);
  }

  async getMarketStatus(now?: Date) {
    const provider = this.providerFor("MARKET_STATUS");
    if (!provider.getMarketStatus) throw providerError("capability_unavailable", "Market status unavailable.");
    return provider.getMarketStatus(now);
  }

  async getOptionChain(underlying: string, input?: { expiration?: string; contract?: string; historicalDate?: string; requireGreeks?: boolean; now?: Date }) {
    const provider = this.providerFor("OPTIONS_CHAIN", "option");
    if (!provider.getOptionChain) throw providerError("capability_unavailable", "Options chain unavailable.");
    return provider.getOptionChain(underlying, input);
  }

  providerFor(capability: PortfolioMarketDataCapability, assetClass?: AssetClass) {
    const provider = this.usableProviders().find((candidate) => {
      const capabilities = candidate.capabilities();
      return capabilities.capabilities.includes(capability) && (!assetClass || capabilities.assetClasses.includes(assetClass));
    });
    if (!provider) throw providerError("capability_unavailable", `No real provider is configured for ${capability}${assetClass ? `/${assetClass}` : ""}.`);
    return provider;
  }

  private usableProviders() {
    return this.providers.filter((provider) => !(this.production && provider.capabilities().fixture));
  }
}

function instrument(symbol: string, displayName: string, assetClass: AssetClass, provider: string, extra: Partial<PortfolioInstrument> = {}): PortfolioInstrument {
  return { instrumentId: `${provider}:${symbol}`, symbol, displayName, assetClass, subtype: null, exchange: null, currency: "USD", country: null, sector: null, industry: null, marketCalendar: "US_EQUITY", tickSize: 0.01, lotSize: assetClass === "option" ? 1 : 0.000001, contractMultiplier: assetClass === "option" ? 100 : null, underlying: null, optionStrike: null, optionExpiration: null, optionType: null, bondMaturity: null, coupon: null, providerMappings: { [provider]: symbol }, benchmarkEligible: ["equity", "etf", "index_proxy"].includes(assetClass), status: "active", ...extra };
}

function classifyAsset(type: string): AssetClass {
  if (/etf/i.test(type)) return "etf";
  if (/fund/i.test(type)) return "etf";
  return "equity";
}

function usEquityMarketOpen(now: Date) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 14 * 60 + 30 && minutes < 21 * 60;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(value: unknown, label: string) {
  const parsed = number(value);
  if (parsed === null) throw providerError("malformed_response", `Alpha Vantage response missing ${label}.`);
  return parsed;
}

function providerError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function mapAlphaOption(row: Record<string, unknown>, underlying: string, source: string, now: Date): PortfolioOptionContract {
  const expiration = string(row.expiration) || string(row.expirationDate);
  const contractId = string(row.contractID) || string(row.contract) || string(row.symbol);
  const typeValue = string(row.type || row.option_type || row.optionType).toLowerCase();
  if (!contractId || !expiration) throw providerError("malformed_response", "Option contract response missing contract ID or expiration.");
  return {
    contractId,
    underlying,
    optionType: typeValue === "put" ? "put" : "call",
    strike: requiredNumber(row.strike, `option strike ${contractId}`),
    expiration,
    multiplier: 100,
    bid: number(row.bid),
    ask: number(row.ask),
    last: number(row.last) ?? number(row.mark),
    volume: number(row.volume),
    openInterest: number(row.open_interest ?? row.openInterest),
    impliedVolatility: number(row.implied_volatility ?? row.impliedVolatility),
    observedAt: now.toISOString(),
    lifecycle: optionLifecycle(expiration, now),
    source,
    fixture: false,
  };
}

function optionLifecycle(expiration: string, now: Date): PortfolioOptionContract["lifecycle"] {
  const expiry = Date.parse(`${expiration}T21:00:00.000Z`);
  if (!Number.isFinite(expiry)) return "ACTIVE";
  if (now.getTime() > expiry) return "EXPIRED";
  if (expiry - now.getTime() <= 3 * 86_400_000) return "EXPIRING";
  return "ACTIVE";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
