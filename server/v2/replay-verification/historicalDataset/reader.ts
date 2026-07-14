import { createReadStream, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { createGunzip } from "zlib";
import { join } from "path";
import type { ReplaySourceEvent } from "../../replay/contracts";
import { historicalRecordSchema, type HistoricalDatasetValidation, type HistoricalReplayCursor, type HistoricalReplayDatasetManifest, type HistoricalReplayRecord } from "./contracts";
import { createHistoricalCursor, validateCursorForManifest } from "./cursor";
import { hashFile } from "./hashing";
import { compareHistoricalRecords, comparePartitions } from "./ordering";

export async function validateHistoricalDataset(input: { manifest: HistoricalReplayDatasetManifest; manifestHash: string; rootDirectory: string }): Promise<HistoricalDatasetValidation> {
  const failures: HistoricalDatasetValidation["failures"] = [];
  const partitionIds = new Set<string>();
  for (const partition of input.manifest.partitions) {
    if (partitionIds.has(partition.partitionId)) failures.push({ code: "duplicate_partition", message: "Duplicate partition ID", partitionId: partition.partitionId });
    partitionIds.add(partition.partitionId);
    const path = join(input.rootDirectory, partition.relativePath);
    if (!existsSync(path)) { failures.push({ code: "missing_partition", message: "Partition file is missing", partitionId: partition.partitionId }); continue; }
    const stat = statSync(path);
    if (stat.size !== partition.byteSize) failures.push({ code: "byte_size_mismatch", message: "Partition byte size changed", partitionId: partition.partitionId });
    const hash = await hashFile(path);
    if (hash !== partition.contentHash) failures.push({ code: "partition_hash_mismatch", message: "Partition hash changed", partitionId: partition.partitionId });
  }
  for (const a of input.manifest.partitions) for (const b of input.manifest.partitions) {
    if (a.partitionId >= b.partitionId || a.symbol !== b.symbol || a.timeframe !== b.timeframe) continue;
    if (Date.parse(a.endTimestamp) >= Date.parse(b.startTimestamp) && a.contentHash !== b.contentHash) failures.push({ code: "overlapping_partition", message: "Overlapping contradictory partition coverage", partitionId: `${a.partitionId},${b.partitionId}` });
  }
  return { ok: failures.length === 0, manifestHash: input.manifestHash, partitionCount: input.manifest.partitions.length, totalRecordCount: input.manifest.totalRecordCount, failures };
}

export async function* streamHistoricalRecords(input: { manifest: HistoricalReplayDatasetManifest; manifestHash: string; rootDirectory: string; start: string; end: string; symbols: string[]; timeframes: string[]; cursor?: HistoricalReplayCursor }): AsyncGenerator<{ record: HistoricalReplayRecord; cursor: HistoricalReplayCursor; byteOffset: number }> {
  if (input.cursor) validateCursorForManifest(input.cursor, input.manifest, input.manifestHash);
  const startMs = Date.parse(input.start);
  const endMs = Date.parse(input.end);
  const seen = new Set<string>();
  const partitions = [...input.manifest.partitions]
    .sort(comparePartitions)
    .filter(partition => input.symbols.includes(partition.symbol) && input.timeframes.includes(partition.timeframe))
    .filter(partition => Date.parse(partition.endTimestamp) >= startMs && Date.parse(partition.startTimestamp) <= endMs);
  for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
    const partition = partitions[partitionIndex];
    if (input.cursor && partitionIndex < input.cursor.partitionIndex) continue;
    const rows: Array<{ record: HistoricalReplayRecord; line: number; byteOffset: number }> = [];
    let line = 0;
    let byteOffset = 0;
    for await (const raw of readLines(join(input.rootDirectory, partition.relativePath), partition.compression)) {
      line += 1;
      byteOffset += Buffer.byteLength(raw) + 1;
      if (!raw.trim()) continue;
      const record = historicalRecordSchema.parse(JSON.parse(raw));
      if (record.symbol && record.symbol !== partition.symbol) throw new Error(`record symbol does not match partition ${partition.partitionId}`);
      if (record.timeframe && record.timeframe !== partition.timeframe) throw new Error(`record timeframe does not match partition ${partition.partitionId}`);
      if (Date.parse(record.publicationTime) < startMs || Date.parse(record.publicationTime) > endMs) continue;
      if (Date.parse(record.effectiveTime) > Date.parse(record.publicationTime)) throw new Error(`future-data policy violation ${record.recordId}`);
      rows.push({ record, line, byteOffset });
    }
    rows.sort((a, b) => compareHistoricalRecords(a.record, b.record));
    for (let recordIndex = 0; recordIndex < rows.length; recordIndex += 1) {
      if (input.cursor && partitionIndex === input.cursor.partitionIndex && recordIndex <= input.cursor.recordIndex) continue;
      const row = rows[recordIndex];
      if (seen.has(row.record.recordId)) throw new Error(`duplicate source record ${row.record.recordId}`);
      seen.add(row.record.recordId);
      yield { record: row.record, byteOffset: row.byteOffset, cursor: createHistoricalCursor({ manifest: input.manifest, manifestHash: input.manifestHash, partitionId: partition.partitionId, partitionIndex, recordIndex, byteOffset: row.byteOffset, record: row.record }) };
    }
  }
}

export async function readHistoricalReplayEvents(input: Parameters<typeof streamHistoricalRecords>[0]) {
  const events: ReplaySourceEvent[] = [];
  let cursor: HistoricalReplayCursor | null = null;
  for await (const row of streamHistoricalRecords(input)) {
    events.push(toReplaySourceEvent(row.record));
    cursor = row.cursor;
  }
  return { events, cursor };
}

export function toReplaySourceEvent(record: HistoricalReplayRecord): ReplaySourceEvent {
  return { eventId: record.recordId, sourceId: record.sourceId, priority: priorityFor(record.recordType), effectiveAt: record.effectiveTime, publishedAt: record.publicationTime, type: `historical.${record.recordType}`, payload: { ...record.payload, symbol: record.symbol ?? null, timeframe: record.timeframe ?? null, sourceSequence: record.sourceSequence, eventTime: record.eventTime } };
}

async function* readLines(path: string, compression: "none" | "gzip") {
  const stream = compression === "gzip" ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

function priorityFor(recordType: HistoricalReplayRecord["recordType"]) {
  return ({ market_session: 0, candle: 10, economic_event: 20, corporate_event: 30, fundamental_publication: 40, revision: 50, late_arriving_correction: 60 })[recordType];
}
