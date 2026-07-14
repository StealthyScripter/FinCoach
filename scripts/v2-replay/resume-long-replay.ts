import { readFileSync } from "fs";
import { dirname, join } from "path";
import { deterministicFixtureEvents, HistoricalDatasetReplaySource, loadHistoricalDatasetManifest, ReplayVerificationService, validateHistoricalDataset, validateReplayManifest } from "../../server/v2/replay-verification";

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
  const cursor = JSON.parse(readFileSync(inputSummaryPath, "utf8")).cursor ?? null;
  const source = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: manifest.startTime, end: manifest.endTime, symbols: manifest.symbols, timeframes: manifest.timeframes });
  return service.runFromSource({ manifest: { ...manifest, replayMode: "resume" }, source, initialCursor: cursor, batchSize: Number(process.argv.includes("--batch-size") ? process.argv[process.argv.indexOf("--batch-size") + 1] : 1000), writeArtifacts: true });
}
