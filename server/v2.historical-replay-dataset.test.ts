import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import {
  hashFile,
  hashHistoricalDatasetManifest,
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
writeJsonl(join(root, "part-a.jsonl"), recordsA);
writeJsonl(join(root, "part-b.jsonl"), recordsB);

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
    { partitionId: "a", relativePath: "part-a.jsonl", format: "jsonl", compression: "none", symbol: "EUR_USD", timeframe: "M15", startTimestamp: "2020-01-01T00:00:00.000Z", endTimestamp: "2020-01-01T02:00:00.000Z", recordCount: recordsA.length, contentHash: await hashFile(join(root, "part-a.jsonl")), byteSize: Buffer.byteLength(recordsA.map(JSON.stringify).join("\n") + "\n") },
    { partitionId: "b", relativePath: "part-b.jsonl", format: "jsonl", compression: "none", symbol: "GBP_USD", timeframe: "H1", startTimestamp: "2020-01-01T00:00:00.000Z", endTimestamp: "2020-01-01T02:00:00.000Z", recordCount: recordsB.length, contentHash: await hashFile(join(root, "part-b.jsonl")), byteSize: Buffer.byteLength(recordsB.map(JSON.stringify).join("\n") + "\n") },
  ],
  totalRecordCount: recordsA.length + recordsB.length,
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
assert.deepEqual(streamed, ["candle-eu-m15-1", "econ-1", "revision-1", "late-1", "candle-gb-h1-1"]);
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
assert.equal(execFileSync("git", ["check-ignore", `${root}/run/summary.json`], { encoding: "utf8" }).trim(), `${root}/run/summary.json`);

console.log("v2 historical replay dataset tests passed", JSON.stringify({ range: "2020-01-01T00:00:00.000Z/2020-01-01T03:00:00.000Z", symbols: ["EUR_USD", "GBP_USD"], timeframes: ["M15", "H1"], partitions: 2, input: result.inputEventCount, output: result.outputEventCount, checkpoints: result.checkpointCount, restarts: result.restartCount, deterministic: true, safety: result.safety }));

function record(recordId: string, recordType: HistoricalReplayRecord["recordType"], symbol: string | undefined, timeframe: string | undefined, effectiveTime: string, sequence: number): HistoricalReplayRecord {
  return { schemaVersion: "fincoach.v2.historical-record.1", recordId, recordType, sourceId: "fixture-source", sourceSequence: sequence, eventTime: effectiveTime, effectiveTime, publicationTime: "2020-01-01T00:00:00.000Z", symbol, timeframe, payload: { close: 1 + sequence / 100, value: sequence } };
}

function writeJsonl(path: string, records: HistoricalReplayRecord[]) {
  writeFileSync(path, `${records.map(JSON.stringify).join("\n")}\n`);
}

function statSize(path: string) {
  return Number(execFileSync("stat", ["-c", "%s", path], { encoding: "utf8" }).trim());
}
