import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { deterministicFixtureEvents, fixtureManifest, ReplayVerificationService, validateReplayManifest } from "../../server/v2/replay-verification";
import { v2TelemetryService } from "../../server/v2/telemetry";

const manifestArg = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : null;
const modeArg = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "verify";
const manifest = manifestArg ? validateReplayManifest(JSON.parse(readFileSync(manifestArg, "utf8"))) : { ...fixtureManifest("artifacts/v2-replay/verify"), replayMode: modeArg as "verify" };
if (manifest.expectedSafetyState.brokerCallsAllowed || manifest.expectedSafetyState.telegramAllowed || !manifest.expectedSafetyState.liveExecutionBlocked) throw new Error("Unsafe replay manifest");
const result = new ReplayVerificationService(v2TelemetryService).run({ manifest, sourceEvents: deterministicFixtureEvents(manifest.resourceLimits.maxEvents > 30 ? 24 : 12), writeArtifacts: true });
writeFileSync(join(manifest.outputDirectory, "telemetry-snapshot.json"), `${JSON.stringify(v2TelemetryService.snapshot(), null, 2)}\n`);
console.log(JSON.stringify(result));
if (result.status === "failed") process.exit(1);
