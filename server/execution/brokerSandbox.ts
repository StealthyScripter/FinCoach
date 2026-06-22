import type { OrderRequest } from "./domain";

export type SandboxProviderId = "oanda_practice" | "metatrader_demo";
export type SandboxAccountMode = "practice" | "demo";

export type BrokerHealth = {
  provider: SandboxProviderId;
  connected: boolean;
  environment: SandboxAccountMode;
  status: "healthy" | "degraded" | "disconnected";
  reason: string | null;
  checkedAt: string;
  productionOrderSubmissionEnabled: false;
};

export type SandboxAccountSummary = {
  provider: SandboxProviderId;
  accountId: string;
  mode: SandboxAccountMode;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  marginAvailable: number;
  pendingOrderCount: number;
  openPositionCount: number;
  openTradeCount: number;
};

export type BrokerInstrument = {
  internalSymbol: string;
  providerSymbol: string;
  displayName: string;
  pipSize: number;
  tickSize: number;
  tradeUnits: "units" | "lots" | "contracts";
  minSize: number;
  maxSize: number;
  marginRate: number;
  marketHours: string;
};

export type PricingSnapshot = {
  provider: SandboxProviderId;
  internalSymbol: string;
  providerSymbol: string;
  bid: number;
  ask: number;
  mid: number;
  status: "tradeable" | "non_tradeable";
  asOf: string;
  stale: boolean;
};

export type SandboxOrderPreview = {
  id: string;
  provider: SandboxProviderId;
  environment: SandboxAccountMode;
  providerSymbol: string;
  request: OrderRequest;
  estimatedPrice: number;
  estimatedMargin: number;
  estimatedSpreadCost: number;
  riskSummaryHash: string;
  expiresAt: string;
  productionOrderSubmissionEnabled: false;
};

export type SandboxOrderResult = {
  provider: SandboxProviderId;
  orderId: string;
  status: "pending" | "partially_filled" | "filled" | "rejected" | "cancelled";
  reason: string | null;
  submittedAt: string;
  requestedUnits?: number;
  filledUnits?: number;
  remainingUnits?: number;
  averageFillPrice?: number | null;
  productionOrderSubmissionEnabled: false;
};

export type SandboxPosition = {
  id: string;
  instrument: string;
  providerSymbol: string;
  side: "buy" | "sell";
  units: number;
  entryPrice: number;
  unrealizedPnL: number;
};

export type SandboxTrade = {
  id: string;
  instrument: string;
  providerSymbol: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  openedAt: string;
  state: "open" | "closed";
};

export interface DemoBrokerAdapter {
  readonly id: SandboxProviderId;
  readonly environment: SandboxAccountMode;
  readonly productionOrderSubmissionEnabled: false;
  health(): Promise<BrokerHealth>;
  getAccountSummary(): Promise<SandboxAccountSummary>;
  getInstruments(): Promise<BrokerInstrument[]>;
  getPricingSnapshot(symbol: string): Promise<PricingSnapshot>;
  previewOrder(request: OrderRequest): Promise<SandboxOrderPreview>;
  submitSandboxOrder(preview: SandboxOrderPreview): Promise<SandboxOrderResult>;
  getOrderStatus(orderId: string): Promise<SandboxOrderResult>;
  getOpenPositions(): Promise<SandboxPosition[]>;
  getPendingOrders(): Promise<SandboxOrderResult[]>;
  getTrades(): Promise<SandboxTrade[]>;
  closePosition?(positionId: string): Promise<SandboxOrderResult>;
  disconnect(): Promise<BrokerHealth>;
}
