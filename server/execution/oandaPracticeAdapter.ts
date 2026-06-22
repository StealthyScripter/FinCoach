import { randomUUID } from "crypto";
import { SandboxBrokerError, mapBrokerHttpFailure } from "./brokerFailures";
import type {
  BrokerHealth,
  BrokerInstrument,
  DemoBrokerAdapter,
  PricingSnapshot,
  SandboxAccountSummary,
  SandboxOrderPreview,
  SandboxOrderResult,
  SandboxPosition,
  SandboxTrade,
} from "./brokerSandbox";
import type { OrderRequest } from "./domain";
import { hashRiskSummary } from "./orderPreview";
import { getSymbolMapping, listSymbolMappings } from "./symbolMapping";

export type BrokerHttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type BrokerHttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<BrokerHttpResponse>;

export type OandaPracticeConfig = {
  token: string;
  accountId: string;
  environment: string;
  baseUrl?: string;
  maxPriceAgeMs?: number;
};

export class OandaPracticeAdapter implements DemoBrokerAdapter {
  readonly id = "oanda_practice" as const;
  readonly environment = "practice" as const;
  readonly productionOrderSubmissionEnabled = false as const;
  private connected = true;
  private readonly baseUrl: string;
  private readonly maxPriceAgeMs: number;

  constructor(
    private readonly config: OandaPracticeConfig,
    private readonly http: BrokerHttpClient = defaultHttpClient,
  ) {
    if (config.environment.trim().toLowerCase() !== "practice") {
      throw new SandboxBrokerError("demo_environment_required", "OANDA_ENV must be exactly practice.");
    }
    if (!config.token.trim() || !config.accountId.trim()) {
      throw new SandboxBrokerError("token_missing");
    }
    this.baseUrl = config.baseUrl ?? "https://api-fxpractice.oanda.com/v3";
    const host = new URL(this.baseUrl).hostname;
    if (!["api-fxpractice.oanda.com", "localhost", "127.0.0.1"].includes(host)) {
      throw new SandboxBrokerError("demo_environment_required");
    }
    this.maxPriceAgeMs = config.maxPriceAgeMs ?? 30_000;
  }

  async health(): Promise<BrokerHealth> {
    if (!this.connected) return this.healthResult(false, "disconnected", "Disconnected by MarketPilot");
    try {
      await this.getAccountSummary();
      return this.healthResult(true, "healthy", null);
    } catch (error) {
      return this.healthResult(false, "degraded", error instanceof Error ? error.message : "OANDA practice health check failed");
    }
  }

  async getAccountSummary(): Promise<SandboxAccountSummary> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/summary`) as {
      account?: Record<string, unknown>;
    };
    const account = payload.account ?? {};
    return {
      provider: this.id,
      accountId: String(account.id ?? this.config.accountId),
      mode: "practice",
      currency: String(account.currency ?? "USD"),
      balance: number(account.balance),
      equity: number(account.NAV ?? account.balance),
      marginUsed: number(account.marginUsed),
      marginAvailable: number(account.marginAvailable),
      pendingOrderCount: number(account.pendingOrderCount),
      openPositionCount: number(account.openPositionCount),
      openTradeCount: number(account.openTradeCount),
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/instruments`) as {
      instruments?: Array<Record<string, unknown>>;
    };
    const available = new Set((payload.instruments ?? []).map((item) => String(item.name)));
    return listSymbolMappings(this.id)
      .filter((mapping) => available.size === 0 || available.has(mapping.providerSymbol))
      .map(({ marginEstimate: _marginEstimate, ...mapping }) => mapping);
  }

  async getPricingSnapshot(symbol: string): Promise<PricingSnapshot> {
    const mapping = getSymbolMapping(symbol, this.id);
    const payload = await this.request(
      "GET",
      `/accounts/${encodeURIComponent(this.config.accountId)}/pricing?instruments=${encodeURIComponent(mapping.providerSymbol)}`,
    ) as { prices?: Array<Record<string, unknown>> };
    const price = payload.prices?.[0];
    if (!price) throw new SandboxBrokerError("invalid_instrument");
    const bid = number((price.bids as Array<Record<string, unknown>> | undefined)?.[0]?.price);
    const ask = number((price.asks as Array<Record<string, unknown>> | undefined)?.[0]?.price);
    const asOf = String(price.time ?? new Date(0).toISOString());
    const stale = Date.now() - Date.parse(asOf) > this.maxPriceAgeMs;
    return {
      provider: this.id,
      internalSymbol: mapping.internalSymbol,
      providerSymbol: mapping.providerSymbol,
      bid,
      ask,
      mid: round((bid + ask) / 2),
      status: price.tradeable === false ? "non_tradeable" : "tradeable",
      asOf,
      stale,
    };
  }

  async previewOrder(request: OrderRequest): Promise<SandboxOrderPreview> {
    const [account, price] = await Promise.all([this.getAccountSummary(), this.getPricingSnapshot(request.instrument)]);
    if (price.stale) throw new SandboxBrokerError("stale_price");
    if (price.status !== "tradeable") throw new SandboxBrokerError("order_rejected", "The OANDA practice instrument is not currently tradeable.");
    const mapping = getSymbolMapping(request.instrument, this.id);
    const estimatedPrice = request.side === "buy" ? price.ask : price.bid;
    const notional = Math.abs(request.units * estimatedPrice);
    const estimatedMargin = mapping.marginEstimate(notional);
    if (estimatedMargin > account.marginAvailable) throw new SandboxBrokerError("insufficient_margin");
    const id = randomUUID();
    return {
      id,
      provider: this.id,
      environment: this.environment,
      providerSymbol: mapping.providerSymbol,
      request,
      estimatedPrice,
      estimatedMargin,
      estimatedSpreadCost: round(Math.abs(price.ask - price.bid) * request.units),
      riskSummaryHash: hashRiskSummary({
        id,
        provider: this.id,
        instrument: mapping.internalSymbol,
        units: request.units,
        side: request.side,
        estimatedPrice,
        estimatedMargin,
        stopLoss: request.stopLoss,
      }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      productionOrderSubmissionEnabled: false,
    };
  }

  async submitSandboxOrder(preview: SandboxOrderPreview): Promise<SandboxOrderResult> {
    if (preview.provider !== this.id || preview.environment !== "practice") {
      throw new SandboxBrokerError("demo_environment_required");
    }
    if (Date.parse(preview.expiresAt) < Date.now()) throw new SandboxBrokerError("confirmation_expired");
    const request = preview.request;
    const units = request.side === "sell" ? -Math.abs(request.units) : Math.abs(request.units);
    const order: Record<string, unknown> = {
      instrument: preview.providerSymbol,
      units: String(units),
      type: request.type === "market" ? "MARKET" : request.type.toUpperCase(),
      timeInForce: request.type === "market" ? "FOK" : "GTC",
      positionFill: "DEFAULT",
      stopLossOnFill: { price: String(request.stopLoss) },
    };
    if (request.takeProfit) order.takeProfitOnFill = { price: String(request.takeProfit) };
    if (request.type === "limit") order.price = String(request.limitPrice ?? request.price);
    if (request.type === "stop") order.price = String(request.stopPrice ?? request.price);
    const payload = await this.request(
      "POST",
      `/accounts/${encodeURIComponent(this.config.accountId)}/orders`,
      { order },
    ) as Record<string, Record<string, unknown> | undefined>;
    const transaction = payload.orderFillTransaction ?? payload.orderCreateTransaction ?? payload.orderRejectTransaction;
    const rejected = Boolean(payload.orderRejectTransaction);
    const requestedUnits = Math.abs(request.units);
    const reportedFilledUnits = Math.abs(number(transaction?.units));
    const filledUnits = payload.orderFillTransaction ? (reportedFilledUnits || requestedUnits) : 0;
    return {
      provider: this.id,
      orderId: String(transaction?.orderID ?? transaction?.id ?? ""),
      status: rejected ? "rejected" : filledUnits > 0 && filledUnits < requestedUnits ? "partially_filled" : payload.orderFillTransaction ? "filled" : "pending",
      reason: rejected ? String(transaction?.rejectReason ?? "OANDA practice rejected the order") : null,
      submittedAt: String(transaction?.time ?? new Date().toISOString()),
      requestedUnits,
      filledUnits,
      remainingUnits: Math.max(0, requestedUnits - filledUnits),
      averageFillPrice: transaction?.price === undefined ? null : number(transaction.price),
      productionOrderSubmissionEnabled: false,
    };
  }

  async getOrderStatus(orderId: string): Promise<SandboxOrderResult> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/orders/${encodeURIComponent(orderId)}`) as {
      order?: Record<string, unknown>;
    };
    const order = payload.order ?? {};
    return this.orderResult(order);
  }

  async getPendingOrders(): Promise<SandboxOrderResult[]> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/pendingOrders`) as {
      orders?: Array<Record<string, unknown>>;
    };
    return (payload.orders ?? []).map((order) => this.orderResult(order));
  }

  async getOpenPositions(): Promise<SandboxPosition[]> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/openPositions`) as {
      positions?: Array<Record<string, unknown>>;
    };
    return (payload.positions ?? []).flatMap((position) => {
      const mapping = getSymbolMapping(String(position.instrument), this.id);
      const long = position.long as Record<string, unknown> | undefined;
      const short = position.short as Record<string, unknown> | undefined;
      const longUnits = number(long?.units);
      const shortUnits = Math.abs(number(short?.units));
      const side = longUnits > 0 ? "buy" as const : "sell" as const;
      const leg = longUnits > 0 ? long : short;
      const units = longUnits > 0 ? longUnits : shortUnits;
      if (!units) return [];
      return [{
        id: `${mapping.providerSymbol}-${side}`,
        instrument: mapping.internalSymbol,
        providerSymbol: mapping.providerSymbol,
        side,
        units,
        entryPrice: number(leg?.averagePrice),
        unrealizedPnL: number(leg?.unrealizedPL),
      }];
    });
  }

  async getTrades(): Promise<SandboxTrade[]> {
    const payload = await this.request("GET", `/accounts/${encodeURIComponent(this.config.accountId)}/openTrades`) as {
      trades?: Array<Record<string, unknown>>;
    };
    return (payload.trades ?? []).map((trade) => {
      const mapping = getSymbolMapping(String(trade.instrument), this.id);
      const units = number(trade.currentUnits);
      return {
        id: String(trade.id),
        instrument: mapping.internalSymbol,
        providerSymbol: mapping.providerSymbol,
        side: units < 0 ? "sell" : "buy",
        units: Math.abs(units),
        price: number(trade.price),
        openedAt: String(trade.openTime),
        state: String(trade.state).toUpperCase() === "OPEN" ? "open" : "closed",
      };
    });
  }

  async disconnect() {
    this.connected = false;
    return this.healthResult(false, "disconnected", "Disconnected by MarketPilot");
  }

  private async request(method: string, path: string, body?: unknown) {
    if (!this.connected) throw new SandboxBrokerError("provider_disconnected");
    const response = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        "User-Agent": "MarketPilot-Sandbox/3.5",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = brokerErrorDetail(payload);
      throw mapBrokerHttpFailure(response.status, detail);
    }
    return payload;
  }

  private orderResult(order: Record<string, unknown>): SandboxOrderResult {
    const state = String(order.state ?? "PENDING").toUpperCase();
    const requestedUnits = Math.abs(number(order.units ?? order.initialUnits));
    const filledUnits = Math.abs(number(order.filledUnits));
    const partiallyFilled = state === "PARTIALLY_FILLED" || filledUnits > 0 && requestedUnits > filledUnits;
    return {
      provider: this.id,
      orderId: String(order.id ?? ""),
      status: state === "FILLED" ? "filled" : partiallyFilled ? "partially_filled" : state === "CANCELLED" ? "cancelled" : state === "REJECTED" ? "rejected" : "pending",
      reason: typeof order.reason === "string" ? order.reason : null,
      submittedAt: String(order.createTime ?? new Date().toISOString()),
      requestedUnits: requestedUnits || undefined,
      filledUnits: requestedUnits ? filledUnits : undefined,
      remainingUnits: requestedUnits ? Math.max(0, requestedUnits - filledUnits) : undefined,
      averageFillPrice: order.averageFillPrice === undefined ? null : number(order.averageFillPrice),
      productionOrderSubmissionEnabled: false,
    };
  }

  private healthResult(connected: boolean, status: BrokerHealth["status"], reason: string | null): BrokerHealth {
    return {
      provider: this.id,
      connected,
      environment: this.environment,
      status,
      reason,
      checkedAt: new Date().toISOString(),
      productionOrderSubmissionEnabled: false,
    };
  }
}

export function createOandaPracticeAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  http?: BrokerHttpClient,
) {
  return new OandaPracticeAdapter({
    token: env.OANDA_API_TOKEN ?? "",
    accountId: env.OANDA_ACCOUNT_ID ?? "",
    environment: env.OANDA_ENV ?? "",
  }, http);
}

const defaultHttpClient: BrokerHttpClient = async (url, init) => {
  const response = await fetch(url, init);
  return response;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Number(value.toFixed(5));
}

function brokerErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  return [record.errorMessage, record.errorCode, record.message].filter((value) => typeof value === "string").join(": ") || undefined;
}
