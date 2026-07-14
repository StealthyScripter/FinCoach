import { readFileSync } from "fs";
import { dirname, join } from "path";
import { deterministicFixtureEvents, loadHistoricalDatasetManifest, ReplayVerificationService, validateHistoricalDataset, validateReplayManifest, type ReplayVerificationResult } from "../../server/v2/replay-verification";

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
  if (existingSummary.status !== "failed" && cursor?.position >= existingSummary.inputEventCount) return existingSummary;
  throw new Error("partial historical resume requires durable replay state and will not overwrite existing artifacts");
}
