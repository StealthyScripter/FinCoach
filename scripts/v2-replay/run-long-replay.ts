import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { deterministicFixtureEvents, fixtureManifest, loadHistoricalDatasetManifest, readHistoricalReplayEvents, validateHistoricalDataset, ReplayVerificationService, validateReplayManifest } from "../../server/v2/replay-verification";
import { v2TelemetryService } from "../../server/v2/telemetry";

const manifestArg = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : null;
const modeArg = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "verify";
const manifest = manifestArg ? validateReplayManifest(JSON.parse(readFileSync(manifestArg, "utf8"))) : { ...fixtureManifest("artifacts/v2-replay/verify"), replayMode: modeArg as "verify" };
if (manifest.expectedSafetyState.brokerCallsAllowed || manifest.expectedSafetyState.telegramAllowed || !manifest.expectedSafetyState.liveExecutionBlocked) throw new Error("Unsafe replay manifest");
const sourceEvents = manifest.inputMode === "historical" ? await historicalEvents(manifest) : deterministicFixtureEvents(manifest.resourceLimits.maxEvents > 30 ? 24 : 12);
const result = new ReplayVerificationService(v2TelemetryService).run({ manifest, sourceEvents, writeArtifacts: true });
writeFileSync(join(manifest.outputDirectory, "telemetry-snapshot.json"), `${JSON.stringify(v2TelemetryService.snapshot(), null, 2)}\n`);
console.log(JSON.stringify(result));
if (result.status === "failed") process.exit(1);

async function historicalEvents(manifest: ReturnType<typeof validateReplayManifest>) {
  if (!manifest.historicalDataset) throw new Error("historicalDataset is required");
  const loaded = loadHistoricalDatasetManifest(manifest.historicalDataset.manifestPath);
  if (loaded.manifestHash !== manifest.historicalDataset.manifestHash) throw new Error("dataset manifest hash mismatch");
  const validation = await validateHistoricalDataset(loaded);
  if (!validation.ok) throw new Error(`dataset validation failed: ${JSON.stringify(validation.failures)}`);
  const read = await readHistoricalReplayEvents({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: manifest.startTime, end: manifest.endTime, symbols: manifest.symbols, timeframes: manifest.timeframes });
  mkdirSync(manifest.outputDirectory, { recursive: true });
  writeFileSync(join(manifest.outputDirectory, "dataset-manifest.json"), `${JSON.stringify(loaded.manifest, null, 2)}\n`);
  writeFileSync(join(manifest.outputDirectory, "dataset-manifest.sha256"), `${loaded.manifestHash}\n`);
  writeFileSync(join(manifest.outputDirectory, "partition-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  writeFileSync(join(manifest.outputDirectory, "input-summary.json"), `${JSON.stringify({ inputMode: "historical", inputEventCount: read.events.length, cursor: read.cursor }, null, 2)}\n`);
  return read.events;
}
