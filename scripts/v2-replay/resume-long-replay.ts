import { readFileSync } from "fs";
import { deterministicFixtureEvents, ReplayVerificationService, validateReplayManifest } from "../../server/v2/replay-verification";

const manifestPath = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : "artifacts/v2-replay/verify/manifest.json";
const manifest = validateReplayManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const result = new ReplayVerificationService().run({ manifest: { ...manifest, replayMode: "resume" }, sourceEvents: deterministicFixtureEvents(), writeArtifacts: true });
console.log(JSON.stringify({ resumed: true, status: result.status, runId: result.runId }));
if (result.status === "failed") process.exit(1);
