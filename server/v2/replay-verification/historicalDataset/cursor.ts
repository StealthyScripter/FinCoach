import type { HistoricalReplayCursor, HistoricalReplayDatasetManifest, HistoricalReplayRecord } from "./contracts";
import { historicalCursorSchema } from "./contracts";

export function createHistoricalCursor(input: { manifest: HistoricalReplayDatasetManifest; manifestHash: string; partitionId: string; partitionIndex: number; recordIndex: number; byteOffset: number; record?: HistoricalReplayRecord | null }): HistoricalReplayCursor {
  return historicalCursorSchema.parse({
    schemaVersion: "fincoach.v2.historical-replay-cursor.1",
    datasetId: input.manifest.datasetId,
    datasetVersion: input.manifest.datasetVersion,
    manifestHash: input.manifestHash,
    partitionId: input.partitionId,
    partitionIndex: input.partitionIndex,
    recordIndex: input.recordIndex,
    byteOffset: input.byteOffset,
    lastEmittedRecordId: input.record?.recordId ?? null,
    lastEmittedTimestamp: input.record?.publicationTime ?? null,
  });
}

export function validateCursorForManifest(cursor: HistoricalReplayCursor, manifest: HistoricalReplayDatasetManifest, manifestHash: string) {
  if (cursor.datasetId !== manifest.datasetId || cursor.datasetVersion !== manifest.datasetVersion || cursor.manifestHash !== manifestHash) throw new Error("historical cursor does not match dataset manifest");
  return cursor;
}
