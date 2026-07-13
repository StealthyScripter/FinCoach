import { z } from "zod";

export const economicEventSchema = z.object({
  eventId: z.string().min(1),
  country: z.string().min(2),
  currency: z.string().min(3),
  eventType: z.enum(["central_bank", "speech", "inflation", "employment", "gdp", "pmi", "retail_sales", "trade_balance", "auction", "policy_release"]),
  scheduledAt: z.string().datetime(),
  publishedAt: z.string().datetime(),
  actual: z.number().nullable(),
  forecast: z.number().nullable(),
  previous: z.number().nullable(),
  revision: z.number().nullable(),
  importance: z.enum(["low", "medium", "high", "critical"]),
  source: z.string().min(1),
  sourceTimestamp: z.string().datetime(),
  ingestedAt: z.string().datetime(),
  surprise: z.number().nullable(),
  expiresAt: z.string().datetime(),
});
export type EconomicEvent = z.infer<typeof economicEventSchema>;

export const corporateEventSchema = z.object({
  eventId: z.string().min(1),
  symbol: z.string().min(1),
  eventType: z.enum(["earnings", "dividend", "split", "buyback", "merger", "leadership", "filing", "analyst_revision"]),
  scheduledAt: z.string().datetime(),
  publishedAt: z.string().datetime(),
  values: z.record(z.unknown()),
  source: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type CorporateEvent = z.infer<typeof corporateEventSchema>;

export type FundamentalSnapshot = {
  snapshotId: string;
  symbol: string;
  effectiveAt: string;
  createdAt: string;
  economicEventIds: string[];
  corporateEventIds: string[];
  macroState: Record<string, unknown>;
  sourceCount: number;
  qualityScore: number;
};

export const extractedClaimSchema = z.object({
  claimId: z.string().min(1),
  source: z.string().min(1),
  sourceTimestamp: z.string().datetime(),
  extractionTimestamp: z.string().datetime(),
  modelVersion: z.string().min(1),
  claimType: z.enum(["macro", "corporate", "sentiment", "risk"]),
  structuredValues: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().min(1),
  expiration: z.string().datetime(),
  verificationStatus: z.enum(["verified", "unverified", "rejected"]),
  citation: z.string().min(1),
});
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;

export type FundamentalsRepository = {
  saveEconomic(event: EconomicEvent): Promise<{ inserted: boolean; conflicted: boolean }>;
  saveCorporate(event: CorporateEvent): Promise<{ inserted: boolean; conflicted: boolean }>;
  saveSnapshot(snapshot: FundamentalSnapshot): Promise<void>;
  listEconomic(symbolOrCurrency: string, effectiveAt: string): Promise<EconomicEvent[]>;
  listCorporate(symbol: string, effectiveAt: string): Promise<CorporateEvent[]>;
};
