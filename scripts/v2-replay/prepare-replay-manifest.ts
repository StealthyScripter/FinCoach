import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { fixtureManifest, hashReplayManifest, loadHistoricalDatasetManifest } from "../../server/v2/replay-verification";

const mode = arg("--mode") ?? "fixture";
const outputDirectory = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "artifacts/v2-replay/verify";
const manifest = mode === "historical" ? historicalManifest(outputDirectory) : fixtureManifest(outputDirectory);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(outputDirectory, "manifest.sha256"), `${hashReplayManifest(manifest)}\n`);
console.log(JSON.stringify({ manifest: join(outputDirectory, "manifest.json"), hash: hashReplayManifest(manifest) }));

function historicalManifest(outputDirectory: string) {
  const datasetManifestPath = required("--dataset-manifest");
  const loaded = loadHistoricalDatasetManifest(datasetManifestPath);
  const symbols = required("--symbols").split(",").map(value => value.trim()).filter(Boolean);
  const timeframes = required("--timeframes").split(",").map(value => value.trim()).filter(Boolean);
  const startTime = required("--start");
  const endTime = required("--end");
  return {
    manifestVersion: "fincoach.v2.replay-manifest.1" as const,
    inputMode: "historical" as const,
    runId: arg("--run-id") ?? `historical-${Date.now()}-${randomUUID().slice(0, 8)}`,
    repositoryCommit: arg("--repository-commit") ?? "local-dev",
    startedAt: new Date().toISOString(),
    datasetId: loaded.manifest.datasetId,
    datasetVersion: loaded.manifest.datasetVersion,
    datasetHashes: { datasetManifest: loaded.manifestHash, ...Object.fromEntries(loaded.manifest.partitions.map(partition => [partition.partitionId, partition.contentHash])) },
    symbols,
    timeframes,
    startTime,
    endTime,
    replayMode: (arg("--campaign") ?? "custom") as "custom",
    seed: Number(arg("--seed") ?? 42),
    checkpointInterval: Number(arg("--checkpoint-interval") ?? 1000),
    restartSchedule: (arg("--restart-schedule") ?? "").split(",").filter(Boolean).map(Number),
    workerCount: Number(arg("--worker-count") ?? 1),
    resourceLimits: { maxEvents: Number(arg("--max-events") ?? loaded.manifest.totalRecordCount), maxHeapMb: Number(arg("--max-heap-mb") ?? 8192) },
    featureSchemaVersions: { features: "fincoach.v2.features.1" },
    eventSchemaVersions: { replay: "fincoach.v2.event.1", historicalDataset: loaded.manifest.schemaVersion },
    expectedSafetyState: { liveExecutionBlocked: true as const, brokerCallsAllowed: false as const, telegramAllowed: false as const },
    outputDirectory,
    historicalDataset: { manifestPath: datasetManifestPath, manifestHash: loaded.manifestHash },
  };
}

function arg(name: string) {
  return process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
}

function required(name: string) {
  const value = arg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}
