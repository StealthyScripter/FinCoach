import { randomUUID } from "crypto";
import { z } from "zod";

export const executionModeSchema = z.enum(["backtest", "paper", "supervised_live"]);
export const orderSideSchema = z.enum(["buy", "sell"]);
export const orderTypeSchema = z.enum(["market", "limit", "stop"]);

export const instrumentSchema = z.object({
  symbol: z.string().min(1),
  assetClass: z.enum(["forex", "commodity"]),
  baseCurrency: z.string().min(1),
  quoteCurrency: z.string().min(1),
  contractType: z.enum(["spot", "cfd", "futures_reference"]),
  pipSize: z.number().positive(),
  tickSize: z.number().positive(),
  lotSize: z.number().positive(),
  marginRequirement: z.number().positive().max(1),
  sessionHours: z.string().min(1),
  providerMappings: z.record(z.string(), z.string()),
});

export type Instrument = z.infer<typeof instrumentSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type OrderSide = z.infer<typeof orderSideSchema>;
export type OrderType = z.infer<typeof orderTypeSchema>;

export const INSTRUMENTS: Instrument[] = [
  instrument("EUR/USD", "forex", "EUR", "USD", 0.0001, 0.00001, 100_000, 0.0333, { oanda: "EUR_USD", metatrader5: "EURUSD", tradingview: "OANDA:EURUSD" }),
  instrument("GBP/USD", "forex", "GBP", "USD", 0.0001, 0.00001, 100_000, 0.0333, { oanda: "GBP_USD", metatrader5: "GBPUSD", tradingview: "OANDA:GBPUSD" }),
  instrument("USD/JPY", "forex", "USD", "JPY", 0.01, 0.001, 100_000, 0.0333, { oanda: "USD_JPY", metatrader5: "USDJPY", tradingview: "OANDA:USDJPY" }),
  instrument("XAU/USD", "commodity", "XAU", "USD", 0.1, 0.01, 100, 0.05, { oanda: "XAU_USD", metatrader5: "XAUUSD", tradingview: "OANDA:XAUUSD" }),
  instrument("XAG/USD", "commodity", "XAG", "USD", 0.01, 0.001, 5_000, 0.1, { oanda: "XAG_USD", metatrader5: "XAGUSD", tradingview: "OANDA:XAGUSD" }),
  instrument("WTI", "commodity", "WTI", "USD", 0.01, 0.01, 1_000, 0.1, { oanda: "WTICO_USD", metatrader5: "XTIUSD", tradingview: "TVC:USOIL" }),
  instrument("Brent", "commodity", "BRENT", "USD", 0.01, 0.01, 1_000, 0.1, { oanda: "BCO_USD", metatrader5: "XBRUSD", tradingview: "TVC:UKOIL" }),
];

function instrument(
  symbol: string,
  assetClass: Instrument["assetClass"],
  baseCurrency: string,
  quoteCurrency: string,
  pipSize: number,
  tickSize: number,
  lotSize: number,
  marginRequirement: number,
  providerMappings: Record<string, string>,
): Instrument {
  return {
    symbol,
    assetClass,
    baseCurrency,
    quoteCurrency,
    contractType: symbol === "WTI" || symbol === "Brent" ? "futures_reference" : "cfd",
    pipSize,
    tickSize,
    lotSize,
    marginRequirement,
    sessionHours: assetClass === "forex" ? "Sun 17:00-Fri 17:00 America/New_York" : "Provider session; daily maintenance break applies",
    providerMappings,
  };
}

export function normalizeSymbol(value: string): Instrument | undefined {
  const normalized = value.trim().toUpperCase().replace(/[_-]/g, "/");
  return INSTRUMENTS.find((item) => {
    if (item.symbol.toUpperCase() === normalized) return true;
    if (item.symbol.replace("/", "").toUpperCase() === normalized.replace("/", "")) return true;
    return Object.values(item.providerMappings).some((mapping) => mapping.toUpperCase() === value.trim().toUpperCase());
  });
}

export const strategyTypeSchema = z.enum([
  "moving_average_crossover",
  "rsi_mean_reversion",
  "breakout",
  "news_event",
  "volatility_breakout",
  "trend_following",
  "carry_trade",
  "custom_rule",
]);

export const strategyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: strategyTypeSchema,
  entryRule: z.string().min(1),
  exitRule: z.string().min(1),
  stopRule: z.string().min(1),
  riskPerTradePct: z.number().positive().max(5),
  maxTradesPerDay: z.number().int().positive().max(50),
  allowedInstruments: z.array(z.string()).min(1),
  allowedSession: z.string().min(1),
  invalidationRule: z.string().min(1),
  enabled: z.boolean().default(true),
});

export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;

export const tradingViewSignalSchema = z.object({
  symbol: z.string().min(1),
  direction: z.enum(["buy", "sell", "long", "short"]),
  strategyName: z.string().min(1),
  timeframe: z.string().min(1),
  price: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive().optional(),
  confidence: z.number().min(0).max(100),
  timestamp: z.string().datetime(),
  signature: z.string().min(16),
  nonce: z.string().min(8).optional(),
});
export const tradingSignalSchema = tradingViewSignalSchema.omit({ signature: true });

export type TradingViewSignal = z.infer<typeof tradingViewSignalSchema>;

export const orderRequestSchema = z.object({
  strategyId: z.string().min(1),
  instrument: z.string().min(1),
  side: orderSideSchema,
  type: orderTypeSchema,
  units: z.number().positive(),
  price: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive().optional(),
  mode: executionModeSchema,
  explicitUserConfirmation: z.boolean().default(false),
  correlationId: z.string().default(() => randomUUID()),
});

export type OrderRequest = z.infer<typeof orderRequestSchema>;

export type BrokerAccount = {
  id: string;
  provider: string;
  mode: ExecutionMode;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  connected: boolean;
};

export type ExecutionOrder = OrderRequest & {
  id: string;
  provider: string;
  status: "pending" | "filled" | "rejected";
  createdAt: string;
  rejectionReason?: string;
};

export type Fill = {
  id: string;
  orderId: string;
  instrument: string;
  side: OrderSide;
  units: number;
  price: number;
  slippage: number;
  commission: number;
  filledAt: string;
};

export type Position = {
  id: string;
  instrument: string;
  side: OrderSide;
  units: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  marginUsed: number;
  stopLossStatus: "active" | "triggered";
  takeProfitStatus: "active" | "triggered" | "not_set";
  staleData: boolean;
  openedAt: string;
  updatedAt: string;
};

export interface BrokerAccountProvider {
  getAccount(): Promise<BrokerAccount>;
}

export interface MarketOrderProvider {
  placeMarketOrder(request: OrderRequest): Promise<ExecutionOrder>;
}

export interface LimitOrderProvider {
  placeLimitOrder(request: OrderRequest): Promise<ExecutionOrder>;
}

export interface StopOrderProvider {
  placeStopOrder(request: OrderRequest): Promise<ExecutionOrder>;
}

export interface PositionProvider {
  getPositions(): Promise<Position[]>;
}

export interface FillProvider {
  getFills(): Promise<Fill[]>;
}

export interface ExecutionProvider extends BrokerAccountProvider, MarketOrderProvider, LimitOrderProvider, StopOrderProvider, PositionProvider, FillProvider {
  readonly id: string;
  readonly environment: "local" | "demo" | "live";
  readonly liveOrderPlacementEnabled: boolean;
}
