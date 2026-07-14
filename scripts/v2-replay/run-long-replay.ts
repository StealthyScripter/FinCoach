import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { deterministicFixtureEvents, fixtureManifest, HistoricalDatasetReplaySource, loadHistoricalDatasetManifest, validateHistoricalDataset, ReplayVerificationService, validateReplayManifest } from "../../server/v2/replay-verification";
import { v2TelemetryService } from "../../server/v2/telemetry";

const manifestArg = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : null;
const modeArg = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "verify";
const manifest = manifestArg ? validateReplayManifest(JSON.parse(readFileSync(manifestArg, "utf8"))) : { ...fixtureManifest("artifacts/v2-replay/verify"), replayMode: modeArg as "verify" };
if (manifest.expectedSafetyState.brokerCallsAllowed || manifest.expectedSafetyState.telegramAllowed || !manifest.expectedSafetyState.liveExecutionBlocked) throw new Error("Unsafe replay manifest");
const service = new ReplayVerificationService(v2TelemetryService);
const result = manifest.inputMode === "historical"
  ? await runHistorical(manifest, service)
  : service.run({ manifest, sourceEvents: deterministicFixtureEvents(manifest.resourceLimits.maxEvents > 30 ? 24 : 12), writeArtifacts: true });
writeFileSync(join(manifest.outputDirectory, "telemetry-snapshot.json"), `${JSON.stringify(v2TelemetryService.snapshot(), null, 2)}\n`);
console.log(JSON.stringify(result));
if (result.status === "failed") process.exit(1);

async function runHistorical(manifest: ReturnType<typeof validateReplayManifest>, service: ReplayVerificationService) {
  if (!manifest.historicalDataset) throw new Error("historicalDataset is required");
  const loaded = loadHistoricalDatasetManifest(manifest.historicalDataset.manifestPath);
  if (loaded.manifestHash !== manifest.historicalDataset.manifestHash) throw new Error("dataset manifest hash mismatch");
  const validation = await validateHistoricalDataset(loaded);
  if (!validation.ok) throw new Error(`dataset validation failed: ${JSON.stringify(validation.failures)}`);
  mkdirSync(manifest.outputDirectory, { recursive: true });
  const source = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: manifest.startTime, end: manifest.endTime, symbols: manifest.symbols, timeframes: manifest.timeframes });
  const result = await service.runFromSource({ manifest, source, batchSize: Number(process.argv.includes("--batch-size") ? process.argv[process.argv.indexOf("--batch-size") + 1] : 1000), writeArtifacts: true });
  writeFileSync(join(manifest.outputDirectory, "dataset-manifest.json"), `${JSON.stringify(loaded.manifest, null, 2)}\n`);
  writeFileSync(join(manifest.outputDirectory, "dataset-manifest.sha256"), `${loaded.manifestHash}\n`);
  writeFileSync(join(manifest.outputDirectory, "partition-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  writeFileSync(join(manifest.outputDirectory, "input-summary.json"), `${JSON.stringify({ inputMode: "historical", inputEventCount: result.inputEventCount, sourceReadCount: result.sourceReadCount, maxBatchRetained: result.maxBatchRetained, cursor: result.finalSourceCursor }, null, 2)}\n`);
  return result;
}
