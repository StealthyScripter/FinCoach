import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { gzipSync } from "zlib";
import { ReplayV2Service } from "./v2/replay";
import {
  hashFile,
  hashHistoricalDatasetManifest,
  HistoricalDatasetReplaySource,
  loadHistoricalDatasetManifest,
  readHistoricalReplayEvents,
  ReplayVerificationService,
  requiredReplayArtifacts,
  streamHistoricalRecords,
  validateHistoricalDataset,
  validateHistoricalDatasetManifest,
  validateReplayResult,
  type HistoricalReplayDatasetManifest,
  type HistoricalReplayRecord,
} from "./v2/replay-verification";

const root = "artifacts/v2-replay/historical-fixture";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const recordsA: HistoricalReplayRecord[] = [
  record("candle-eu-m15-1", "candle", "EUR_USD", "M15", "2020-01-01T00:00:00.000Z", 2),
  record("econ-1", "economic_event", undefined, undefined, "2020-01-01T00:00:00.000Z", 3),
  record("revision-1", "revision", "EUR_USD", "M15", "2020-01-01T00:00:00.000Z", 5),
  record("late-1", "late_arriving_correction", "EUR_USD", "M15", "2020-01-01T00:00:00.000Z", 6),
];
const recordsB: HistoricalReplayRecord[] = [
  record("candle-gb-h1-1", "candle", "GBP_USD", "H1", "2020-01-01T00:00:00.000Z", 1),
];
const recordsC: HistoricalReplayRecord[] = [
  { ...record("candle-eu-m15-gzip", "candle", "EUR_USD", "M15", "2020-01-01T02:00:00.000Z", 7), publicationTime: "2020-01-01T02:00:00.000Z" },
];
writeJsonl(join(root, "part-a.jsonl"), recordsA);
writeJsonl(join(root, "part-b.jsonl"), recordsB);
writeFileSync(join(root, "part-c.jsonl.gz"), gzipSync(`${recordsC.map(JSON.stringify).join("\n")}\n`));

const manifest: HistoricalReplayDatasetManifest = {
  schemaVersion: "fincoach.v2.historical-replay-dataset.1",
  datasetId: "local-historical-fixture",
  datasetVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceDescription: "generated local fixture",
  assetClasses: ["fx"],
  symbols: ["EUR_USD", "GBP_USD"],
  timeframes: ["M15", "H1"],
  earliestTimestamp: "2020-01-01T00:00:00.000Z",
  latestTimestamp: "2020-01-01T02:00:00.000Z",
  publicationTimePolicy: "explicit_required",
  revisionPolicy: "point_in_time_publication",
  corporateActionPolicy: "not_applicable_fx",
  timezonePolicy: "utc",
  partitions: [
    { partitionId: "a", relativePath: "part-a.jsonl", format: "jsonl", compression: "none", symbol: "EUR_USD", timeframe: "M15", startTimestamp: "2020-01-01T00:00:00.000Z", endTimestamp: "2020-01-01T01:59:59.999Z", recordCount: recordsA.length, contentHash: await hashFile(join(root, "part-a.jsonl")), byteSize: Buffer.byteLength(recordsA.map(JSON.stringify).join("\n") + "\n") },
    { partitionId: "b", relativePath: "part-b.jsonl", format: "jsonl", compression: "none", symbol: "GBP_USD", timeframe: "H1", startTimestamp: "2020-01-01T00:00:00.000Z", endTimestamp: "2020-01-01T02:00:00.000Z", recordCount: recordsB.length, contentHash: await hashFile(join(root, "part-b.jsonl")), byteSize: Buffer.byteLength(recordsB.map(JSON.stringify).join("\n") + "\n") },
    { partitionId: "c", relativePath: "part-c.jsonl.gz", format: "jsonl", compression: "gzip", symbol: "EUR_USD", timeframe: "M15", startTimestamp: "2020-01-01T02:00:00.000Z", endTimestamp: "2020-01-01T03:00:00.000Z", recordCount: recordsC.length, contentHash: await hashFile(join(root, "part-c.jsonl.gz")), byteSize: statSize(join(root, "part-c.jsonl.gz")) },
  ],
  totalRecordCount: recordsA.length + recordsB.length + recordsC.length,
  contentHashAlgorithm: "sha256",
};
const manifestHash = hashHistoricalDatasetManifest(manifest);
writeFileSync(join(root, "manifest.json"), `${JSON.stringify({ ...manifest, manifestHash }, null, 2)}\n`);

const loaded = loadHistoricalDatasetManifest(join(root, "manifest.json"));
assert.equal(loaded.manifestHash, manifestHash);
assert.equal(validateHistoricalDatasetManifest({ ...manifest, manifestHash }).datasetId, "local-historical-fixture");
assert.equal((await validateHistoricalDataset(loaded)).ok, true);

const streamed: string[] = [];
let cursor = null as Awaited<ReturnType<typeof readHistoricalReplayEvents>>["cursor"];
for await (const row of streamHistoricalRecords({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T03:00:00.000Z", symbols: ["EUR_USD", "GBP_USD"], timeframes: ["M15", "H1"] })) {
  streamed.push(row.record.recordId);
  cursor = row.cursor;
}
assert.deepEqual(streamed, ["candle-eu-m15-1", "econ-1", "revision-1", "late-1", "candle-gb-h1-1", "candle-eu-m15-gzip"]);
assert.ok(cursor);

const filtered = await readHistoricalReplayEvents({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T00:30:00.000Z", symbols: ["EUR_USD"], timeframes: ["M15"] });
assert.equal(filtered.events.length, 4);
assert.equal(filtered.events[0].eventId, "candle-eu-m15-1");
assert.equal(filtered.events.some(event => event.eventId.startsWith("fixture-")), false);

const resumed = [];
for await (const row of streamHistoricalRecords({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T03:00:00.000Z", symbols: ["EUR_USD", "GBP_USD"], timeframes: ["M15", "H1"], cursor })) resumed.push(row.record.recordId);
assert.equal(resumed.length, 0);
await assert.rejects(readHistoricalReplayEvents({ manifest: loaded.manifest, manifestHash: "0".repeat(64), rootDirectory: loaded.rootDirectory, start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T03:00:00.000Z", symbols: ["EUR_USD"], timeframes: ["M15"], cursor: cursor! }), /cursor does not match/);

const changed = { ...loaded.manifest, partitions: [{ ...loaded.manifest.partitions[0], contentHash: "0".repeat(64) }, loaded.manifest.partitions[1]] };
assert.equal((await validateHistoricalDataset({ manifest: changed, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory })).ok, false);
assert.throws(() => validateHistoricalDatasetManifest({ ...loaded.manifest, partitions: [loaded.manifest.partitions[0], loaded.manifest.partitions[0]] }), /duplicate partition/);
assert.throws(() => validateHistoricalDatasetManifest({ ...loaded.manifest, schemaVersion: "bad" }), /Invalid literal/);
assert.throws(() => validateHistoricalDatasetManifest({ ...loaded.manifest, partitions: [{ ...loaded.manifest.partitions[0], format: "csv" }] }), /Invalid enum value/);
writeFileSync(join(root, "bad.jsonl"), `${JSON.stringify({ ...recordsA[0], publicationTime: "not-a-date" })}\n`);
const badManifest = { ...loaded.manifest, partitions: [{ ...loaded.manifest.partitions[0], relativePath: "bad.jsonl", contentHash: await hashFile(join(root, "bad.jsonl")), byteSize: statSize(join(root, "bad.jsonl")), recordCount: 1 }], totalRecordCount: 1 };
await assert.rejects(readHistoricalReplayEvents({ manifest: badManifest, manifestHash: hashHistoricalDatasetManifest(badManifest), rootDirectory: loaded.rootDirectory, start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T03:00:00.000Z", symbols: ["EUR_USD"], timeframes: ["M15"] }), /Invalid datetime/);

const replayManifest = {
  manifestVersion: "fincoach.v2.replay-manifest.1" as const,
  inputMode: "historical" as const,
  runId: "historical-local-fixture",
  repositoryCommit: "local-dev",
  startedAt: "2026-01-01T00:00:00.000Z",
  datasetId: loaded.manifest.datasetId,
  datasetVersion: loaded.manifest.datasetVersion,
  datasetHashes: { datasetManifest: loaded.manifestHash },
  symbols: ["EUR_USD"],
  timeframes: ["M15"],
  startTime: "2020-01-01T00:00:00.000Z",
  endTime: "2020-01-01T03:00:00.000Z",
  replayMode: "custom" as const,
  seed: 42,
  checkpointInterval: 2,
  restartSchedule: [2],
  workerCount: 1,
  resourceLimits: { maxEvents: 20, maxHeapMb: 512 },
  featureSchemaVersions: { features: "fincoach.v2.features.1" },
  eventSchemaVersions: { replay: "fincoach.v2.event.1", historicalDataset: loaded.manifest.schemaVersion },
  expectedSafetyState: { liveExecutionBlocked: true as const, brokerCallsAllowed: false as const, telegramAllowed: false as const },
  outputDirectory: join(root, "run"),
  historicalDataset: { manifestPath: join(root, "manifest.json"), manifestHash: loaded.manifestHash },
};
const result = new ReplayVerificationService().run({ manifest: replayManifest, sourceEvents: filtered.events, writeArtifacts: true });
assert.equal(result.status, "passed");
assert.equal(result.inputMode, "historical");
assert.equal(result.inputEventCount, 4);
assert.equal(result.safety.brokerCalls, 0);
assert.equal(result.safety.telegramMessages, 0);
assert.equal(validateReplayResult(result, [...requiredReplayArtifacts(), "dataset-manifest.json", "dataset-manifest.sha256", "partition-validation.json", "input-summary.json", "telemetry-snapshot.json"]).ok, true);
const completedCursorSource = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: replayManifest.startTime, end: replayManifest.endTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
const completedCursor = (await completedCursorSource.readNext(null, 100)).cursor;
writeFileSync(join(root, "run", "input-summary.json"), `${JSON.stringify({ cursor: completedCursor, inputEventCount: result.inputEventCount }, null, 2)}\n`);
execFileSync("./node_modules/.bin/tsx", ["scripts/v2-replay/resume-long-replay.ts", "--manifest", join(root, "run", "manifest.json")], { encoding: "utf8" });
const preservedSummary = JSON.parse(readFileSync(join(root, "run", "summary.json"), "utf8"));
assert.equal(preservedSummary.inputEventCount, result.inputEventCount);
const baselineSource = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: replayManifest.startTime, end: replayManifest.endTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
const uninterrupted = await new ReplayVerificationService().runFromSource({ manifest: replayManifest, source: baselineSource, batchSize: 2 });
const partialCursorSource = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: replayManifest.startTime, end: replayManifest.endTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
const partialCursor = (await partialCursorSource.readNext(null, 1)).cursor;
writeFileSync(join(root, "run", "summary.json"), `${JSON.stringify({ ...preservedSummary, status: "failed" }, null, 2)}\n`);
writeFileSync(join(root, "run", "input-summary.json"), `${JSON.stringify({ cursor: partialCursor, inputEventCount: result.inputEventCount }, null, 2)}\n`);
const partialResume = execFileSync("./node_modules/.bin/tsx", ["scripts/v2-replay/resume-long-replay.ts", "--manifest", join(root, "run", "manifest.json"), "--batch-size", "1"], { encoding: "utf8" });
assert.match(partialResume, /"resumed":true/);
const resumedSummary = JSON.parse(readFileSync(join(root, "run", "summary.json"), "utf8"));
assert.equal(resumedSummary.status, "passed");
assert.equal(execFileSync("git", ["check-ignore", `${root}/run/summary.json`], { encoding: "utf8" }).trim(), `${root}/run/summary.json`);

const hashes = [];
for (const batchSize of [1, 2, 10, 100]) {
  const source = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: replayManifest.startTime, end: replayManifest.endTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
  const streaming = await new ReplayVerificationService().runFromSource({ manifest: { ...replayManifest, runId: "historical-stream-determinism" }, source, batchSize });
  assert.equal(streaming.status, "passed");
  assert.ok(streaming.maxBatchRetained <= batchSize);
  if (batchSize < streaming.inputEventCount) assert.ok(streaming.sourceReadCount > 1);
  hashes.push(streaming.domainEventHash);
}
assert.equal(new Set(hashes).size, 1);
assert.equal(resumedSummary.domainEventHash, uninterrupted.domainEventHash);

const cursorSource = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: replayManifest.startTime, end: replayManifest.endTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
const firstBatch = await cursorSource.readNext(null, 2);
const secondBatch = await cursorSource.readNext(firstBatch.cursor, 2);
assert.deepEqual(firstBatch.events.map(event => event.eventId), ["candle-eu-m15-1", "econ-1"]);
assert.deepEqual(secondBatch.events.map(event => event.eventId), ["revision-1", "late-1"]);
await assert.rejects(cursorSource.readNext({ ...firstBatch.cursor!, schemaVersion: "bad" }, 2), /unsupported replay source cursor version/);
await assert.rejects(cursorSource.readNext({ ...firstBatch.cursor!, datasetManifestHash: "0".repeat(64) }, 2), /manifest hash mismatch/);

const largeRoot = join(root, "large");
mkdirSync(largeRoot, { recursive: true });
const largeRecords = Array.from({ length: 250 }, (_, index) => {
  const timestamp = new Date(Date.UTC(2020, 0, 2, 0, index)).toISOString();
  return { ...record(`large-${index.toString().padStart(4, "0")}`, "candle", "EUR_USD", "M15", timestamp, index), publicationTime: timestamp };
});
writeJsonl(join(largeRoot, "large.jsonl"), largeRecords);
const largeManifest = { ...loaded.manifest, datasetId: "large-stream-fixture", partitions: [{ partitionId: "large", relativePath: "large.jsonl", format: "jsonl" as const, compression: "none" as const, symbol: "EUR_USD", timeframe: "M15", startTimestamp: largeRecords[0].publicationTime, endTimestamp: largeRecords.at(-1)!.publicationTime, recordCount: largeRecords.length, contentHash: await hashFile(join(largeRoot, "large.jsonl")), byteSize: statSize(join(largeRoot, "large.jsonl")) }], totalRecordCount: largeRecords.length };
const largeHash = hashHistoricalDatasetManifest(largeManifest);
const largeSource = new HistoricalDatasetReplaySource({ manifest: largeManifest, manifestHash: largeHash, rootDirectory: largeRoot, start: largeRecords[0].publicationTime, end: largeRecords.at(-1)!.publicationTime, symbols: ["EUR_USD"], timeframes: ["M15"] });
const largeResult = await new ReplayVerificationService().runFromSource({ manifest: { ...replayManifest, runId: "large-stream-fixture", datasetId: largeManifest.datasetId, datasetHashes: { datasetManifest: largeHash }, startTime: largeRecords[0].publicationTime, endTime: largeRecords.at(-1)!.publicationTime, resourceLimits: { maxEvents: 300, maxHeapMb: 512 }, historicalDataset: { manifestPath: join(largeRoot, "manifest.json"), manifestHash: largeHash } }, source: largeSource, batchSize: 7 });
assert.equal(largeResult.inputEventCount, 250);
assert.ok(largeResult.maxBatchRetained <= 7);
assert.ok(largeResult.sourceReadCount >= 36);

const replay = new ReplayV2Service();
replay.startFromSource({ replayId: "stream-retention", start: largeRecords[0].publicationTime, end: largeRecords.at(-1)!.publicationTime, mode: "event", seed: 1, instruments: ["EUR_USD"], timeframes: ["M15"] }, largeHash);
for (let index = 0; index < 25; index += 1) {
  replay.advanceEvent("stream-retention", { eventId: `retained-${index}`, sourceId: "retention", priority: 1, effectiveAt: largeRecords[index].effectiveTime, publishedAt: largeRecords[index].publicationTime, type: "historical.candle", payload: {} }, { schemaVersion: "fincoach.v2.replay-source.historical-dataset.1", sourceId: "retention", position: index + 1, lastEventId: `retained-${index}`, lastOrderingKey: `retained-${index}` });
}
assert.ok((replay.get("stream-retention")?.deliveredEventIds.length ?? 0) <= 1);

console.log("v2 historical replay dataset tests passed", JSON.stringify({ range: "2020-01-01T00:00:00.000Z/2020-01-01T03:00:00.000Z", symbols: ["EUR_USD", "GBP_USD"], timeframes: ["M15", "H1"], partitions: 3, input: result.inputEventCount, output: result.outputEventCount, checkpoints: result.checkpointCount, restarts: result.restartCount, deterministic: true, safety: result.safety }));

function record(recordId: string, recordType: HistoricalReplayRecord["recordType"], symbol: string | undefined, timeframe: string | undefined, effectiveTime: string, sequence: number): HistoricalReplayRecord {
  return { schemaVersion: "fincoach.v2.historical-record.1", recordId, recordType, sourceId: "fixture-source", sourceSequence: sequence, eventTime: effectiveTime, effectiveTime, publicationTime: "2020-01-01T00:00:00.000Z", symbol, timeframe, payload: { close: 1 + sequence / 100, value: sequence } };
}

function writeJsonl(path: string, records: HistoricalReplayRecord[]) {
  writeFileSync(path, `${records.map(JSON.stringify).join("\n")}\n`);
}

function statSize(path: string) {
  return Number(execFileSync("stat", ["-c", "%s", path], { encoding: "utf8" }).trim());
}
