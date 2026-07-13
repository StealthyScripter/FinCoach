import { z } from "zod";
import { normalizedCandleSchema, normalizedQuoteSchema } from "../market-data";

export const marketSessionSchema = z.enum(["asia", "london", "new_york", "london_new_york_overlap", "closed"]);
export type MarketSession = z.infer<typeof marketSessionSchema>;

export const marketContextInputSchema = z.object({
  symbol: z.string().min(1),
  assetClass: z.enum(["forex", "metal", "stock"]),
  observedAt: z.string().datetime(),
  quote: normalizedQuoteSchema.optional(),
  candles: z.array(normalizedCandleSchema).default([]),
  events: z.array(z.object({
    id: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    impact: z.enum(["low", "medium", "high", "critical"]),
    category: z.enum(["macro", "earnings", "central_bank", "liquidity", "holiday"]),
    symbols: z.array(z.string()).default([]),
  })).default([]),
  calendarFreshAsOf: z.string().datetime().nullable().default(null),
  higherTimeframeDirection: z.enum(["up", "down", "sideways", "unknown"]).default("unknown"),
  crossAssetContext: z.record(z.unknown()).default({}),
});
export type MarketContextInput = z.infer<typeof marketContextInputSchema>;

export type MarketContext = {
  contextId: string;
  symbol: string;
  assetClass: MarketContextInput["assetClass"];
  observedAt: string;
  activeSession: MarketSession;
  marketOpen: boolean;
  sessionOverlap: boolean;
  spreadState: "unknown" | "tight" | "normal" | "wide";
  liquidityState: "closed" | "thin" | "normal" | "deep";
  volatilityPercentile: number | null;
  trendRangeRegime: "trend" | "range" | "unknown";
  eventProximity: "none" | "watch" | "blackout";
  economicReleaseProximity: "none" | "watch" | "blackout";
  earningsProximity: "none" | "watch" | "blackout";
  higherTimeframeDirection: "up" | "down" | "sideways" | "unknown";
  crossAssetContext: Record<string, unknown>;
  holiday: boolean;
  rollover: boolean;
  dataQualityState: "fresh" | "stale" | "missing";
  warnings: string[];
};
