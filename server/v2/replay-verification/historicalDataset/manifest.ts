import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { historicalDatasetManifestSchema, type HistoricalReplayDatasetManifest } from "./contracts";
import { hashObject } from "./hashing";

export function loadHistoricalDatasetManifest(path: string) {
  const manifest = validateHistoricalDatasetManifest(JSON.parse(readFileSync(path, "utf8")));
  return { manifest, manifestPath: path, rootDirectory: dirname(resolve(path)), manifestHash: hashHistoricalDatasetManifest(manifest) };
}

export function validateHistoricalDatasetManifest(input: unknown): HistoricalReplayDatasetManifest {
  const manifest = historicalDatasetManifestSchema.parse(input);
  if (Date.parse(manifest.earliestTimestamp) > Date.parse(manifest.latestTimestamp)) throw new Error("dataset coverage is inverted");
  const ids = new Set<string>();
  for (const partition of manifest.partitions) {
    if (ids.has(partition.partitionId)) throw new Error(`duplicate partition ${partition.partitionId}`);
    ids.add(partition.partitionId);
    if (Date.parse(partition.startTimestamp) > Date.parse(partition.endTimestamp)) throw new Error(`partition ${partition.partitionId} has inverted coverage`);
  }
  const counted = manifest.partitions.reduce((sum, partition) => sum + partition.recordCount, 0);
  if (counted !== manifest.totalRecordCount) throw new Error("manifest totalRecordCount does not match partitions");
  return manifest;
}

export function hashHistoricalDatasetManifest(manifest: HistoricalReplayDatasetManifest) {
  const { manifestHash: _ignored, ...hashable } = manifest;
  return hashObject(hashable);
}
