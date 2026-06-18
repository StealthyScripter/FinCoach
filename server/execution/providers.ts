import { randomUUID } from "crypto";
import type { BrokerAccount, ExecutionOrder, ExecutionProvider, Fill, OrderRequest, Position } from "./domain";
import { normalizeSymbol } from "./domain";
import { executionAuditLog, executionRiskService } from "./riskControls";
import { executionRiskPrecheckService } from "./riskPrecheck";

abstract class BaseExecutionProvider implements ExecutionProvider {
  abstract readonly id: string;
  abstract readonly environment: "local" | "demo" | "live";
  abstract readonly liveOrderPlacementEnabled: boolean;
  protected orders: ExecutionOrder[] = [];
  protected fills: Fill[] = [];
  protected positions: Position[] = [];
  protected connected = true;

  async getAccount(): Promise<BrokerAccount> {
    return {
      id: `${this.id}-account`,
      provider: this.id,
      mode: this.environment === "live" ? "supervised_live" : "paper",
      currency: "USD",
      balance: 100_000,
      equity: 100_000 + this.positions.reduce((sum, item) => sum + item.unrealizedPnL, 0),
      marginUsed: this.positions.reduce((sum, item) => sum + item.marginUsed, 0),
      connected: this.connected,
    };
  }

  placeMarketOrder(request: OrderRequest) {
    return this.place(request);
  }

  placeLimitOrder(request: OrderRequest) {
    return this.place(request);
  }

  placeStopOrder(request: OrderRequest) {
    return this.place(request);
  }

  async getPositions() {
    return [...this.positions];
  }

  async getFills() {
    return [...this.fills];
  }

  async closeAllPositions() {
    const closed = this.positions.length;
    this.positions = [];
    executionAuditLog.append({
      action: "positions.close_all",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { provider: this.id, closed, environment: this.environment },
    });
    return { closed };
  }

  async disconnect() {
    this.connected = false;
    executionAuditLog.append({
      action: "provider.disconnect",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { provider: this.id, environment: this.environment },
    });
    return { disconnected: true, provider: this.id };
  }

  protected async place(request: OrderRequest): Promise<ExecutionOrder> {
    const account = await this.getAccount();
    const instrumentExposure = this.positions
      .filter((position) => position.instrument === request.instrument)
      .reduce((sum, position) => sum + Math.abs(position.units * position.currentPrice), 0);
    const requestedExposure = Math.abs(request.units * request.price);
    const circuit = executionRiskService.snapshot();
    const precheck = executionRiskPrecheckService.evaluate(request, {
      dataAgeSeconds: circuit.dataAgeSeconds,
      maxDataAgeSeconds: circuit.maxDataAgeSeconds,
      spread: 0,
      maxSpread: Number.POSITIVE_INFINITY,
      volatilityPct: circuit.volatilityPct,
      maxVolatilityPct: circuit.maxVolatilityPct,
      dailyLoss: circuit.dailyLoss,
      maxDailyLoss: circuit.maxDailyLoss,
      openPositions: this.positions.length,
      maxOpenPositions: 2,
      symbolExposure: instrumentExposure,
      requestedExposure,
      maxSymbolExposure: account.equity * 2,
      correlatedExposure: this.positions.reduce((sum, position) => sum + Math.abs(position.units * position.currentPrice), 0),
      maxCorrelatedExposure: account.equity * 4,
      newsBlackoutActive: false,
      consecutiveLosses: circuit.consecutiveLosses,
      maxConsecutiveLosses: circuit.maxConsecutiveLosses,
      strategyEnabled: !circuit.strategyKillSwitches.includes(request.strategyId),
      killSwitchActive: circuit.globalKillSwitch || circuit.assetKillSwitches.includes(request.instrument),
      accountConnected: account.connected,
      accountLastSyncAgeSeconds: 0,
      maxAccountSyncAgeSeconds: 60,
    });
    executionAuditLog.append({
      action: "risk.precheck.v2",
      outcome: precheck.action === "approve" || precheck.action === "reduce_size" ? "accepted" : "blocked",
      correlationId: request.correlationId,
      detail: {
        provider: this.id,
        instrument: request.instrument,
        action: precheck.action,
        sizeMultiplier: precheck.sizeMultiplier,
        reasons: precheck.reasons,
      },
    });
    const risk = executionRiskService.check(request);
    const instrument = normalizeSymbol(request.instrument);
    const liveBlocked = request.mode === "supervised_live" && !this.liveOrderPlacementEnabled;
    const reasons = [
      ...(!precheck.approved ? precheck.reasons : []),
      ...risk.reasons,
      !instrument ? "Unsupported instrument" : null,
      liveBlocked ? `${this.id} live order placement is environment-gated and disabled` : null,
    ].filter((item): item is string => Boolean(item));
    const effectiveRequest = precheck.action === "reduce_size"
      ? { ...request, units: Math.max(0.0001, request.units * precheck.sizeMultiplier) }
      : request;
    const order: ExecutionOrder = {
      ...effectiveRequest,
      id: randomUUID(),
      provider: this.id,
      status: reasons.length ? "rejected" : "filled",
      rejectionReason: reasons.join("; ") || undefined,
      createdAt: new Date().toISOString(),
    };
    this.orders.push(order);

    if (order.status === "rejected" || !instrument) {
      executionAuditLog.append({
        action: "order.place",
        outcome: "rejected",
        correlationId: request.correlationId,
        detail: { provider: this.id, instrument: request.instrument, precheck: precheck.action, reasons },
      });
      return order;
    }

    const slippage = request.price * 0.00005;
    const fillPrice = request.side === "buy" ? request.price + slippage : request.price - slippage;
    const fill: Fill = {
      id: randomUUID(),
      orderId: order.id,
      instrument: instrument.symbol,
      side: request.side,
      units: effectiveRequest.units,
      price: fillPrice,
      slippage,
      commission: 0,
      filledAt: new Date().toISOString(),
    };
    this.fills.push(fill);
    this.positions.push({
      id: randomUUID(),
      instrument: instrument.symbol,
      side: request.side,
      units: effectiveRequest.units,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      unrealizedPnL: 0,
      realizedPnL: 0,
      marginUsed: effectiveRequest.units * fillPrice * instrument.marginRequirement,
      stopLossStatus: "active",
      takeProfitStatus: request.takeProfit ? "active" : "not_set",
      staleData: false,
      openedAt: fill.filledAt,
      updatedAt: fill.filledAt,
    });
    executionAuditLog.append({
      action: "order.place",
      outcome: "filled",
      correlationId: request.correlationId,
      detail: { provider: this.id, orderId: order.id, fillId: fill.id, mode: request.mode, precheck: precheck.action },
    });
    return order;
  }
}

export class DemoExecutionProvider extends BaseExecutionProvider {
  readonly id = "demo";
  readonly environment = "demo" as const;
  readonly liveOrderPlacementEnabled = false;
}

export class PaperExecutionProvider extends BaseExecutionProvider {
  readonly id = "paper";
  readonly environment = "local" as const;
  readonly liveOrderPlacementEnabled = false;
}

export class OandaExecutionProvider extends BaseExecutionProvider {
  readonly id = "oanda";
  readonly environment = process.env.OANDA_ENVIRONMENT === "live" ? "live" as const : "demo" as const;
  readonly liveOrderPlacementEnabled = false;
}

export class MetaTraderExecutionProvider extends BaseExecutionProvider {
  readonly id = "metatrader5";
  readonly environment = process.env.MT5_ENVIRONMENT === "live" ? "live" as const : "demo" as const;
  readonly liveOrderPlacementEnabled = false;
}

export class RobinhoodCryptoExecutionProvider extends BaseExecutionProvider {
  readonly id = "robinhood_crypto";
  readonly environment = "demo" as const;
  readonly liveOrderPlacementEnabled = false;

  protected override async place(request: OrderRequest): Promise<ExecutionOrder> {
    return {
      ...request,
      id: randomUUID(),
      provider: this.id,
      status: "rejected",
      rejectionReason: "Robinhood adapter is reserved for a later crypto milestone",
      createdAt: new Date().toISOString(),
    };
  }
}

export const paperExecutionProvider = new PaperExecutionProvider();
