import { z } from "zod";
import { v2Timeframes } from "../market-data";

export const oandaPriceComponentSchema = z.enum(["mid", "bid", "ask", "bid_ask"]);
export type OandaPriceComponent = z.infer<typeof oandaPriceComponentSchema>;

export const historicalPartitionPolicySchema = z.object({
  strategy: z.enum(["symbol_timeframe", "monthly"]).default("symbol_timeframe"),
  format: z.enum(["jsonl", "ndjson"]).default("jsonl"),
  compression: z.enum(["none", "gzip"]).default("none"),
  maxRecordsPerPartition: z.number().int().positive().default(100_000),
});
export type HistoricalPartitionPolicy = z.infer<typeof historicalPartitionPolicySchema>;

export const historicalDatasetBuildRequestSchema = z.object({
  schemaVersion: z.literal("fincoach.v2.oanda-dataset-build-request.1"),
  provider: z.literal("oanda"),
  environment: z.literal("practice"),
  symbols: z.array(z.string().min(1)).min(1),
  timeframes: z.array(z.enum(v2Timeframes)).min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  priceComponent: oandaPriceComponentSchema,
  outputDirectory: z.string().min(1),
  datasetId: z.string().min(1).optional(),
  datasetVersion: z.string().min(1).optional(),
  partitionPolicy: historicalPartitionPolicySchema,
  resume: z.boolean().default(false),
  overwrite: z.literal(false),
  maxCandlesPerRequest: z.number().int().positive().max(5000).default(5000),
  rateLimitMs: z.number().int().nonnegative().default(250),
  maxRetries: z.number().int().nonnegative().default(2),
  allowIncompleteFinalCandle: z.boolean().default(false),
}).superRefine((request, ctx) => {
  if (Date.parse(request.startTime) >= Date.parse(request.endTime)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
});
export type HistoricalDatasetBuildRequest = z.infer<typeof historicalDatasetBuildRequestSchema>;

export type HistoricalDatasetBuildResult = {
  datasetId: string;
  datasetVersion: string;
  manifestPath: string;
  manifestHash: string;
  symbols: string[];
  timeframes: string[];
  requestedRange: { startTime: string; endTime: string };
  actualRange: { startTime: string; endTime: string };
  candleCount: number;
  partitionCount: number;
  gaps: number;
  duplicatesSuppressed: number;
  rejectedRecords: number;
  resumed: boolean;
  validationStatus: "passed" | "passed_with_warnings" | "failed";
};

export type OandaDatasetBuildEnv = {
  OANDA_ENV?: string;
  OANDA_API_TOKEN?: string;
  OANDA_ACCOUNT_ID?: string;
  MARKETPILOT_DEMO_ONLY?: string;
  FINCOACH_LIVE_EXECUTION?: string;
  OANDA_BASE_URL?: string;
};

export type OandaCandlePage = {
  candles: OandaRawCandle[];
  requestId: string | null;
  retryAfterMs: number | null;
};

export type OandaRawCandle = {
  time: string;
  complete?: boolean;
  volume?: number;
  mid?: OandaOhlc;
  bid?: OandaOhlc;
  ask?: OandaOhlc;
};

export type OandaOhlc = { o: string; h: string; l: string; c: string };

export type OandaHistoricalClient = {
  listInstruments(): Promise<string[]>;
  fetchCandles(input: { instrument: string; granularity: string; from: string; to: string; price: string; count: number }): Promise<OandaCandlePage>;
};

