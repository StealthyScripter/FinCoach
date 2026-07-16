import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { deterministicFixtureEvents, HistoricalDatasetReplaySource, loadHistoricalDatasetManifest, ReplayVerificationService, validateHistoricalDataset, validateReplayManifest, type ReplayVerificationResult } from "../../server/v2/replay-verification";

const manifestPath = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : "artifacts/v2-replay/verify/manifest.json";
const manifest = validateReplayManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const service = new ReplayVerificationService();
const result = manifest.inputMode === "historical" ? await resumeHistorical() : service.run({ manifest: { ...manifest, replayMode: "resume" }, sourceEvents: deterministicFixtureEvents(), writeArtifacts: true });
console.log(JSON.stringify({ resumed: true, status: result.status, runId: result.runId }));
if (result.status === "failed") process.exit(1);

async function resumeHistorical() {
  if (!manifest.historicalDataset) throw new Error("historicalDataset is required");
  const loaded = loadHistoricalDatasetManifest(manifest.historicalDataset.manifestPath);
  if (loaded.manifestHash !== manifest.historicalDataset.manifestHash) throw new Error("dataset manifest hash mismatch");
  const validation = await validateHistoricalDataset(loaded);
  if (!validation.ok) throw new Error(`dataset validation failed: ${JSON.stringify(validation.failures)}`);
  const inputSummaryPath = join(dirname(manifestPath), "input-summary.json");
  const summaryPath = join(dirname(manifestPath), "summary.json");
  const existingSummary = JSON.parse(readFileSync(summaryPath, "utf8")) as ReplayVerificationResult;
  const inputSummary = JSON.parse(readFileSync(inputSummaryPath, "utf8"));
  const cursor = inputSummary.cursor ?? null;
  if (!cursor) throw new Error("partial historical resume requires a durable source cursor");
  const source = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: manifest.startTime, end: manifest.endTime, symbols: manifest.symbols, timeframes: manifest.timeframes });
  await source.readNext(cursor, 1);
  if (existingSummary.status !== "failed" && cursor.position >= existingSummary.inputEventCount) return existingSummary;
  if (existingSummary.status !== "failed") throw new Error("historical resume refuses to overwrite non-failed replay artifacts");
  const result = await service.runFromSource({ manifest, source, batchSize: Number(process.argv.includes("--batch-size") ? process.argv[process.argv.indexOf("--batch-size") + 1] : 1000), writeArtifacts: true });
  writeFileSync(join(dirname(manifestPath), "dataset-manifest.json"), `${JSON.stringify(loaded.manifest, null, 2)}\n`);
  writeFileSync(join(dirname(manifestPath), "dataset-manifest.sha256"), `${loaded.manifestHash}\n`);
  writeFileSync(join(dirname(manifestPath), "partition-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  writeFileSync(join(dirname(manifestPath), "input-summary.json"), `${JSON.stringify({ inputMode: "historical", inputEventCount: result.inputEventCount, sourceReadCount: result.sourceReadCount, maxBatchRetained: result.maxBatchRetained, cursor: result.finalSourceCursor, resumedFromCursor: cursor }, null, 2)}\n`);
  return result;
}
