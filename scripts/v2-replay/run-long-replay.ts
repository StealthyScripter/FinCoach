import { readFileSync } from "fs";
import { deterministicFixtureEvents, fixtureManifest, ReplayVerificationService, validateReplayManifest } from "../../server/v2/replay-verification";

const manifestArg = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : null;
const modeArg = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "verify";
const manifest = manifestArg ? validateReplayManifest(JSON.parse(readFileSync(manifestArg, "utf8"))) : { ...fixtureManifest("artifacts/v2-replay/verify"), replayMode: modeArg as "verify" };
if (manifest.expectedSafetyState.brokerCallsAllowed || manifest.expectedSafetyState.telegramAllowed || !manifest.expectedSafetyState.liveExecutionBlocked) throw new Error("Unsafe replay manifest");
const result = new ReplayVerificationService().run({ manifest, sourceEvents: deterministicFixtureEvents(manifest.resourceLimits.maxEvents > 30 ? 24 : 12), writeArtifacts: true });
console.log(JSON.stringify(result));
if (result.status === "failed") process.exit(1);
