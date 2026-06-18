import { randomUUID } from "crypto";
import type { OrderRequest } from "./domain";
import { INSTRUMENTS, normalizeSymbol } from "./domain";
import type { FinalConfirmationService } from "./finalConfirmation";
import type { LiveTradingPermissionService } from "./liveTradingPermission";
import { orderPreviewService, type ControlledOrderPreviewInput } from "./orderPreview";
import { executionAuditLog, executionRiskService } from "./riskControls";

type Permission = ReturnType<LiveTradingPermissionService["evaluate"]>;
type Confirmation = ReturnType<FinalConfirmationService["confirm"]>;
type Preview = ReturnType<typeof orderPreviewService.create>;

export type SandboxOrder = {
  id: string;
  provider: string;
  previewId: string;
  status: "sandbox_filled" | "sandbox_rejected";
  request: OrderRequest;
  rejectionReason?: string;
  createdAt: string;
};

export interface SandboxBrokerAdapter {
  readonly id: string;
  readonly environment: "sandbox";
  readonly productionSubmitEnabled: false;
  syncAccount(): Promise<{ id: string; currency: string; balance: number; equity: number; marginAvailable: number; connected: boolean; mode: "sandbox" }>;
  lookupInstrument(symbol: string): Promise<ReturnType<typeof normalizeSymbol>>;
  previewOrder(input: ControlledOrderPreviewInput): Promise<Preview>;
  submitSandboxOrder(input: { request: OrderRequest; preview: Preview; permission: Permission; confirmation: Confirmation }): Promise<SandboxOrder>;
  getOrderStatus(orderId: string): Promise<SandboxOrder | undefined>;
  syncPositions(): Promise<Array<{ id: string; instrument: string; side: string; units: number; entryPrice: number }>>;
  disconnect(): Promise<{ disconnected: boolean; provider: string }>;
}

abstract class BaseSandboxBrokerAdapter implements SandboxBrokerAdapter {
  abstract readonly id: string;
  readonly environment = "sandbox" as const;
  readonly productionSubmitEnabled = false as const;
  protected connected = true;
  protected orders: SandboxOrder[] = [];
  protected positions: Array<{ id: string; instrument: string; side: string; units: number; entryPrice: number }> = [];
  protected usedConfirmationIds = new Set<string>();

  async syncAccount() {
    const usedMargin = this.positions.reduce((sum, item) => sum + Math.abs(item.units * item.entryPrice) * 0.05, 0);
    const account = {
      id: `${this.id}-sandbox-account`,
      currency: "USD",
      balance: 100_000,
      equity: 100_000,
      marginAvailable: 100_000 - usedMargin,
      connected: this.connected,
      mode: "sandbox" as const,
    };
    executionAuditLog.append({
      action: "sandbox.account.sync",
      outcome: this.connected ? "accepted" : "rejected",
      correlationId: randomUUID(),
      detail: { provider: this.id, accountId: account.id, connected: this.connected },
    });
    return account;
  }

  async lookupInstrument(symbol: string) {
    const instrument = normalizeSymbol(symbol);
    executionAuditLog.append({
      action: "sandbox.instrument.lookup",
      outcome: instrument ? "accepted" : "rejected",
      correlationId: randomUUID(),
      detail: { provider: this.id, requestedSymbol: symbol, normalizedSymbol: instrument?.symbol ?? null },
    });
    return instrument;
  }

  async previewOrder(input: ControlledOrderPreviewInput) {
    if (!this.connected) throw new Error(`${this.id} sandbox is disconnected`);
    if (input.provider !== this.id || input.environment !== "sandbox") throw new Error("Sandbox preview environment mismatch");
    return orderPreviewService.create(input);
  }

  async submitSandboxOrder({ request, preview, permission, confirmation }: { request: OrderRequest; preview: Preview; permission: Permission; confirmation: Confirmation }) {
    const reasons = [
      !this.connected ? "Sandbox provider is disconnected" : null,
      executionRiskService.snapshot().globalKillSwitch ? "Global kill switch is triggered" : null,
      !permission.allowed ? "Live permission gates are incomplete" : null,
      new Date(permission.expirationTimestamp).getTime() < Date.now() ? "Live permission has expired" : null,
      !confirmation.accepted ? "Final confirmation was rejected" : null,
      confirmation.orderPreviewId !== preview.id ? "Confirmation is not bound to this preview" : null,
      confirmation.riskSummaryHash !== preview.riskSummaryHash ? "Confirmation risk hash does not match preview" : null,
      new Date(confirmation.expiresAt).getTime() < Date.now() ? "Final confirmation has expired" : null,
      this.usedConfirmationIds.has(confirmation.id) ? "Final confirmation has already been used" : null,
      preview.provider !== this.id || preview.environment !== "sandbox" ? "Preview provider or environment mismatch" : null,
      request.correlationId !== preview.correlationId ? "Request does not match preview correlation" : null,
      !normalizeSymbol(request.instrument) ? "Unsupported instrument" : null,
    ].filter((reason): reason is string => Boolean(reason));
    const order: SandboxOrder = {
      id: randomUUID(),
      provider: this.id,
      previewId: preview.id,
      status: reasons.length ? "sandbox_rejected" : "sandbox_filled",
      request,
      rejectionReason: reasons.join("; ") || undefined,
      createdAt: new Date().toISOString(),
    };
    this.orders.push(order);
    if (!reasons.length) {
      this.usedConfirmationIds.add(confirmation.id);
      this.positions.push({
        id: randomUUID(),
        instrument: normalizeSymbol(request.instrument)!.symbol,
        side: request.side,
        units: request.units,
        entryPrice: request.price,
      });
    }
    executionAuditLog.append({
      action: "sandbox.order.submit",
      outcome: reasons.length ? "rejected" : "filled",
      correlationId: request.correlationId,
      detail: { provider: this.id, orderId: order.id, previewId: preview.id, reasons, productionSubmitEnabled: false },
    });
    return order;
  }

  async getOrderStatus(orderId: string) {
    const order = this.orders.find((item) => item.id === orderId);
    executionAuditLog.append({
      action: "sandbox.order.status",
      outcome: order ? "accepted" : "rejected",
      correlationId: order?.request.correlationId ?? randomUUID(),
      detail: { provider: this.id, orderId, status: order?.status ?? "not_found" },
    });
    return order;
  }

  async syncPositions() {
    const positions = this.positions.map((position) => ({ ...position }));
    executionAuditLog.append({
      action: "sandbox.positions.sync",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { provider: this.id, positionCount: positions.length },
    });
    return positions;
  }

  async closeAllSandboxPositions() {
    const closed = this.positions.length;
    this.positions = [];
    executionAuditLog.append({
      action: "sandbox.positions.close_all",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { provider: this.id, closed },
    });
    return { provider: this.id, closed };
  }

  async disconnect() {
    this.connected = false;
    executionAuditLog.append({
      action: "sandbox.disconnect",
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { provider: this.id },
    });
    return { disconnected: true, provider: this.id };
  }
}

export class OandaSandboxAdapter extends BaseSandboxBrokerAdapter {
  readonly id = "oanda_sandbox";
}

export class MetaTraderDemoBridgeAdapter extends BaseSandboxBrokerAdapter {
  readonly id = "metatrader_demo";
}

export class GenericRestBrokerSandboxAdapter extends BaseSandboxBrokerAdapter {
  readonly id = "generic_rest_sandbox";
}

export const sandboxBrokerAdapters = {
  oanda: new OandaSandboxAdapter(),
  metatrader: new MetaTraderDemoBridgeAdapter(),
  genericRest: new GenericRestBrokerSandboxAdapter(),
};

export const sandboxSupportedInstruments = INSTRUMENTS.map((instrument) => instrument.symbol);
