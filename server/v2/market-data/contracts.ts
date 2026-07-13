import { z } from "zod";
import { lineageReferenceSchema } from "../lineage";

export const v2Timeframes = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"] as const;
export type V2Timeframe = typeof v2Timeframes[number];

export const assetClassSchema = z.enum(["forex", "metal", "stock"]);
export type AssetClass = z.infer<typeof assetClassSchema>;

export const normalizedSymbolSchema = z.object({
  symbol: z.string().min(1),
  assetClass: assetClassSchema,
  providerSymbols: z.record(z.string()),
});
export type NormalizedSymbol = z.infer<typeof normalizedSymbolSchema>;

export const normalizedQuoteSchema = z.object({
  symbol: z.string().min(1),
  bid: z.number().positive(),
  ask: z.number().positive(),
  mid: z.number().positive(),
  spread: z.number().nonnegative(),
  provider: z.string().min(1),
  observedAt: z.string().datetime(),
  sourceReceivedAt: z.string().datetime(),
  provenance: z.object({
    provider: z.string().min(1),
    providerSymbol: z.string().min(1),
    adapterVersion: z.string().min(1),
  }),
});
export type NormalizedQuote = z.infer<typeof normalizedQuoteSchema>;

export const normalizedCandleSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.enum(v2Timeframes),
  timestamp: z.string().datetime(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  bid: z.object({ open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive() }).optional(),
  ask: z.object({ open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive() }).optional(),
  spread: z.number().nonnegative().nullable(),
  volume: z.number().nonnegative().nullable(),
  tickVolume: z.number().nonnegative().nullable(),
  complete: z.boolean(),
  source: z.object({
    provider: z.string().min(1),
    providerSymbol: z.string().min(1),
    adapterVersion: z.string().min(1),
  }),
  corporateAction: z.object({
    splitAdjusted: z.boolean(),
    dividendAdjusted: z.boolean(),
    adjustmentFactor: z.number().positive().nullable(),
  }).nullable(),
});
export type NormalizedCandle = z.infer<typeof normalizedCandleSchema>;

export type MarketDataQualityReport = {
  symbol: string;
  timeframe: V2Timeframe;
  candlesReceived: number;
  candlesAccepted: number;
  duplicates: number;
  rejected: number;
  gaps: Array<{ from: string; to: string; missingCandles: number }>;
  orderingValid: boolean;
  fresh: boolean;
  qualityScore: number;
  warnings: string[];
};

export type MarketDataImportResult = {
  importId: string;
  idempotencyKey: string;
  status: "imported" | "duplicate" | "rejected" | "partial";
  quality: MarketDataQualityReport;
  lineage: Array<z.infer<typeof lineageReferenceSchema>>;
  events: string[];
};

export type MarketDataProviderAdapter = {
  id: string;
  assetClasses: AssetClass[];
  adapterVersion: string;
  fetchCandles(input: {
    symbol: NormalizedSymbol;
    timeframe: V2Timeframe;
    from?: string;
    to?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<{ candles: unknown[]; nextCursor: string | null; rateLimitedUntil: string | null }>;
};

export type MarketDataRepositoryContract = {
  importCandles(importId: string, candles: NormalizedCandle[]): Promise<{ inserted: number; duplicates: number }>;
  hasImport(idempotencyKey: string): Promise<boolean>;
  recordImport(idempotencyKey: string, result: MarketDataImportResult): Promise<void>;
  saveCheckpoint(key: string, cursor: string | null): Promise<void>;
  readCheckpoint(key: string): Promise<string | null>;
  latestCandle(symbol: string, timeframe: V2Timeframe): Promise<NormalizedCandle | null>;
};
