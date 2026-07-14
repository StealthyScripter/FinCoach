import { z } from "zod";

export const historicalPartitionSchema = z.object({
  partitionId: z.string().min(1),
  relativePath: z.string().min(1),
  format: z.enum(["jsonl", "ndjson", "csv"]),
  compression: z.enum(["none", "gzip"]),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startTimestamp: z.string().datetime(),
  endTimestamp: z.string().datetime(),
  recordCount: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
});

export const historicalDatasetManifestSchema = z.object({
  schemaVersion: z.literal("fincoach.v2.historical-replay-dataset.1"),
  datasetId: z.string().min(1),
  datasetVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  sourceDescription: z.string().min(1),
  assetClasses: z.array(z.string().min(1)).min(1),
  symbols: z.array(z.string().min(1)).min(1),
  timeframes: z.array(z.string().min(1)).min(1),
  earliestTimestamp: z.string().datetime(),
  latestTimestamp: z.string().datetime(),
  publicationTimePolicy: z.string().min(1),
  revisionPolicy: z.string().min(1),
  corporateActionPolicy: z.string().min(1),
  timezonePolicy: z.string().min(1),
  partitions: z.array(historicalPartitionSchema).min(1),
  totalRecordCount: z.number().int().nonnegative(),
  contentHashAlgorithm: z.literal("sha256"),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const historicalRecordSchema = z.object({
  schemaVersion: z.literal("fincoach.v2.historical-record.1"),
  recordId: z.string().min(1),
  recordType: z.enum(["candle", "economic_event", "corporate_event", "fundamental_publication", "market_session", "revision", "late_arriving_correction"]),
  sourceId: z.string().min(1),
  sourceSequence: z.union([z.number().int(), z.string().min(1)]),
  eventTime: z.string().datetime(),
  effectiveTime: z.string().datetime(),
  publicationTime: z.string().datetime(),
  symbol: z.string().min(1).optional(),
  timeframe: z.string().min(1).optional(),
  payload: z.record(z.unknown()),
});

export const historicalCursorSchema = z.object({
  schemaVersion: z.literal("fincoach.v2.historical-replay-cursor.1"),
  datasetId: z.string().min(1),
  datasetVersion: z.string().min(1),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  partitionId: z.string().min(1),
  partitionIndex: z.number().int().nonnegative(),
  recordIndex: z.number().int().nonnegative(),
  byteOffset: z.number().int().nonnegative(),
  lastEmittedRecordId: z.string().nullable(),
  lastEmittedTimestamp: z.string().datetime().nullable(),
});

export type HistoricalReplayPartition = z.infer<typeof historicalPartitionSchema>;
export type HistoricalReplayDatasetManifest = z.infer<typeof historicalDatasetManifestSchema>;
export type HistoricalReplayRecord = z.infer<typeof historicalRecordSchema>;
export type HistoricalReplayCursor = z.infer<typeof historicalCursorSchema>;

export type HistoricalDatasetValidation = {
  ok: boolean;
  manifestHash: string;
  partitionCount: number;
  totalRecordCount: number;
  failures: Array<{ code: string; message: string; partitionId?: string }>;
};
