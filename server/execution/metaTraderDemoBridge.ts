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
import { getSymbolMapping } from "./symbolMapping";

export type MetaTraderBridgeResponse = { ok: boolean; status: number; data: unknown };

export interface MetaTraderBridgeTransport {
  request(method: "GET" | "POST", path: string, body?: unknown): Promise<MetaTraderBridgeResponse>;
}

export class HttpMetaTraderBridgeTransport implements MetaTraderBridgeTransport {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<MetaTraderBridgeResponse> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }
}

export class MetaTraderHttpDemoBridgeAdapter implements DemoBrokerAdapter {
  readonly id = "metatrader_demo" as const;
  readonly environment = "demo" as const;
  readonly productionOrderSubmissionEnabled = false as const;
  private connected = true;

  constructor(private readonly transport: MetaTraderBridgeTransport) {}

  async health(): Promise<BrokerHealth> {
    if (!this.connected) return this.healthResult(false, "disconnected", "Disconnected by MarketPilot");
    try {
      const data = await this.call("GET", "/health") as Record<string, unknown>;
      if (String(data.environment).toLowerCase() !== "demo") throw new SandboxBrokerError("demo_environment_required");
      return this.healthResult(Boolean(data.connected ?? true), "healthy", null);
    } catch (error) {
      return this.healthResult(false, "degraded", error instanceof Error ? error.message : "MetaTrader demo bridge health check failed");
    }
  }

  async getAccountSummary(): Promise<SandboxAccountSummary> {
    const data = await this.call("GET", "/account") as Record<string, unknown>;
    this.assertDemo(data);
    return {
      provider: this.id,
      accountId: String(data.accountId),
      mode: "demo",
      currency: String(data.currency ?? "USD"),
      balance: number(data.balance),
      equity: number(data.equity),
      marginUsed: number(data.marginUsed),
      marginAvailable: number(data.marginAvailable ?? data.freeMargin),
      pendingOrderCount: number(data.pendingOrderCount),
      openPositionCount: number(data.openPositionCount),
      openTradeCount: number(data.openTradeCount ?? data.openPositionCount),
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    const data = await this.call("GET", "/symbols") as { environment?: unknown; symbols?: Array<Record<string, unknown>> };
    this.assertDemo(data as Record<string, unknown>);
    return (data.symbols ?? []).map((symbol) => {
      const mapping = getSymbolMapping(String(symbol.symbol), this.id);
      const { marginEstimate: _marginEstimate, ...base } = mapping;
      return {
        ...base,
        providerSymbol: String(symbol.providerSymbol ?? mapping.providerSymbol),
        minSize: number(symbol.minSize) || mapping.minSize,
        maxSize: number(symbol.maxSize) || mapping.maxSize,
      };
    });
  }

  async getPricingSnapshot(symbol: string): Promise<PricingSnapshot> {
    const mapping = getSymbolMapping(symbol, this.id);
    const data = await this.call("GET", `/pricing/${encodeURIComponent(mapping.providerSymbol)}`) as Record<string, unknown>;
    this.assertDemo(data);
    const bid = number(data.bid);
    const ask = number(data.ask);
    return {
      provider: this.id,
      internalSymbol: mapping.internalSymbol,
      providerSymbol: mapping.providerSymbol,
      bid,
      ask,
      mid: round((bid + ask) / 2),
      status: data.tradeable === false ? "non_tradeable" : "tradeable",
      asOf: String(data.asOf),
      stale: Boolean(data.stale),
    };
  }

  async previewOrder(request: OrderRequest): Promise<SandboxOrderPreview> {
    const mapping = getSymbolMapping(request.instrument, this.id);
    const data = await this.call("POST", "/orders/preview", {
      environment: "demo",
      symbol: mapping.providerSymbol,
      side: request.side,
      type: request.type,
      units: request.units,
      price: request.price,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
    }) as Record<string, unknown>;
    this.assertDemo(data);
    if (data.stale === true) throw new SandboxBrokerError("stale_price");
    if (data.accepted === false) throw new SandboxBrokerError("order_rejected", String(data.reason ?? "MetaTrader demo preview rejected"));
    const id = String(data.previewId ?? randomUUID());
    const estimatedPrice = number(data.estimatedPrice ?? request.price);
    const estimatedMargin = number(data.estimatedMargin);
    return {
      id,
      provider: this.id,
      environment: "demo",
      providerSymbol: mapping.providerSymbol,
      request,
      estimatedPrice,
      estimatedMargin,
      estimatedSpreadCost: number(data.estimatedSpreadCost),
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
      expiresAt: String(data.expiresAt ?? new Date(Date.now() + 60_000).toISOString()),
      productionOrderSubmissionEnabled: false,
    };
  }

  async submitSandboxOrder(preview: SandboxOrderPreview): Promise<SandboxOrderResult> {
    if (preview.provider !== this.id || preview.environment !== "demo") throw new SandboxBrokerError("demo_environment_required");
    if (Date.parse(preview.expiresAt) < Date.now()) throw new SandboxBrokerError("confirmation_expired");
    const data = await this.call("POST", "/orders", { environment: "demo", preview }) as Record<string, unknown>;
    this.assertDemo(data);
    return orderResult(data);
  }

  async getOrderStatus(orderId: string) {
    const data = await this.call("GET", `/orders/${encodeURIComponent(orderId)}`) as Record<string, unknown>;
    this.assertDemo(data);
    return orderResult(data);
  }

  async getPendingOrders() {
    const data = await this.call("GET", "/orders?status=pending") as { environment?: unknown; orders?: Array<Record<string, unknown>> };
    this.assertDemo(data as Record<string, unknown>);
    return (data.orders ?? []).map(orderResult);
  }

  async getOpenPositions(): Promise<SandboxPosition[]> {
    const data = await this.call("GET", "/positions") as { environment?: unknown; positions?: Array<Record<string, unknown>> };
    this.assertDemo(data as Record<string, unknown>);
    return (data.positions ?? []).map((position) => {
      const mapping = getSymbolMapping(String(position.symbol), this.id);
      return {
        id: String(position.id),
        instrument: mapping.internalSymbol,
        providerSymbol: String(position.providerSymbol ?? mapping.providerSymbol),
        side: String(position.side).toLowerCase() === "sell" ? "sell" : "buy",
        units: number(position.units),
        entryPrice: number(position.entryPrice),
        unrealizedPnL: number(position.unrealizedPnL),
      };
    });
  }

  async getTrades(): Promise<SandboxTrade[]> {
    const positions = await this.getOpenPositions();
    return positions.map((position) => ({
      id: position.id,
      instrument: position.instrument,
      providerSymbol: position.providerSymbol,
      side: position.side,
      units: position.units,
      price: position.entryPrice,
      openedAt: new Date().toISOString(),
      state: "open",
    }));
  }

  async closePosition(positionId: string) {
    const data = await this.call("POST", `/positions/${encodeURIComponent(positionId)}/close`, { environment: "demo" }) as Record<string, unknown>;
    this.assertDemo(data);
    return orderResult(data);
  }

  async disconnect() {
    if (this.connected) await this.call("POST", "/disconnect", { environment: "demo" });
    this.connected = false;
    return this.healthResult(false, "disconnected", "Disconnected by MarketPilot");
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    if (!this.connected) throw new SandboxBrokerError("provider_disconnected");
    const response = await this.transport.request(method, path, body);
    if (!response.ok) {
      const data = response.data as Record<string, unknown> | undefined;
      throw mapBrokerHttpFailure(response.status, typeof data?.message === "string" ? data.message : undefined);
    }
    return response.data;
  }

  private assertDemo(data: Record<string, unknown>) {
    if (String(data.environment ?? "demo").toLowerCase() !== "demo") throw new SandboxBrokerError("demo_environment_required");
  }

  private healthResult(connected: boolean, status: BrokerHealth["status"], reason: string | null): BrokerHealth {
    return {
      provider: this.id,
      connected,
      environment: "demo",
      status,
      reason,
      checkedAt: new Date().toISOString(),
      productionOrderSubmissionEnabled: false,
    };
  }
}

function orderResult(data: Record<string, unknown>): SandboxOrderResult {
  const value = String(data.status ?? "pending").toLowerCase();
  const requestedUnits = number(data.requestedUnits ?? data.units);
  const filledUnits = number(data.filledUnits);
  const partiallyFilled = value === "partially_filled" || value === "partial" || filledUnits > 0 && requestedUnits > filledUnits;
  const status = partiallyFilled ? "partially_filled" : value === "filled" || value === "rejected" || value === "cancelled" ? value : "pending";
  return {
    provider: "metatrader_demo",
    orderId: String(data.orderId ?? data.id),
    status,
    reason: typeof data.reason === "string" ? data.reason : null,
    submittedAt: String(data.submittedAt ?? new Date().toISOString()),
    requestedUnits: requestedUnits || undefined,
    filledUnits: requestedUnits ? filledUnits : undefined,
    remainingUnits: requestedUnits ? Math.max(0, requestedUnits - filledUnits) : undefined,
    averageFillPrice: data.averageFillPrice === undefined ? null : number(data.averageFillPrice),
    productionOrderSubmissionEnabled: false,
  };
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Number(value.toFixed(5));
}
