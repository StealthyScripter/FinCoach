import { z } from "zod";
import { eventReferenceSchema } from "../core";

export const supportedInstrumentSchema = z.object({
  symbol: z.string().min(1),
  display: z.string().min(1),
  market: z.enum(["forex", "metal", "stock"]),
  priority: z.number().int().positive(),
  enabled: z.boolean(),
  demoFixture: z.boolean(),
});

export type SupportedInstrument = z.infer<typeof supportedInstrumentSchema>;

export const supportedInstruments: SupportedInstrument[] = [
  { symbol: "EUR_USD", display: "EUR/USD", market: "forex", priority: 1, enabled: true, demoFixture: false },
  { symbol: "GBP_USD", display: "GBP/USD", market: "forex", priority: 1, enabled: true, demoFixture: false },
  { symbol: "USD_JPY", display: "USD/JPY", market: "forex", priority: 1, enabled: true, demoFixture: false },
  { symbol: "XAU_USD", display: "XAU/USD", market: "metal", priority: 2, enabled: true, demoFixture: false },
  { symbol: "XAG_USD", display: "XAG/USD", market: "metal", priority: 2, enabled: true, demoFixture: false },
  { symbol: "AAPL", display: "AAPL", market: "stock", priority: 3, enabled: true, demoFixture: true },
  { symbol: "MSFT", display: "MSFT", market: "stock", priority: 3, enabled: true, demoFixture: true },
  { symbol: "TSLA", display: "TSLA", market: "stock", priority: 3, enabled: true, demoFixture: true },
];

export const candleSchema = z.object({
  instrument: z.string().min(1),
  timeframe: z.enum(["1m", "5m", "15m", "30m","1h", "4h", "1d", "1w", "1mo"]),
  timestamp: z.string().datetime(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});

export type Candle = z.infer<typeof candleSchema>;

export type MarketSnapshot = {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  provider: "mock" | "oanda_practice" | "manual";
  observedAt: string;
};

export type SessionContext = {
  instrument: string;
  session: "asia" | "london" | "new_york" | "overlap" | "off_hours";
  observedAt: string;
};

export type VolatilityState = {
  instrument: string;
  timeframe: Candle["timeframe"];
  atr: number;
  state: "compressed" | "normal" | "expanded";
};

export type SpreadState = {
  instrument: string;
  spread: number;
  state: "tight" | "normal" | "wide";
};

export type EconomicContext = {
  instrument: string;
  impact: "none" | "low" | "medium" | "high";
  blackout: boolean;
  source: "fixture" | "calendar";
  sourceEventRefs: z.infer<typeof eventReferenceSchema>[];
};
