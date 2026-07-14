import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fixtureManifest, hashReplayManifest } from "../../server/v2/replay-verification";

const outputDirectory = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "artifacts/v2-replay/verify";
const manifest = fixtureManifest(outputDirectory);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(outputDirectory, "manifest.sha256"), `${hashReplayManifest(manifest)}\n`);
console.log(JSON.stringify({ manifest: join(outputDirectory, "manifest.json"), hash: hashReplayManifest(manifest) }));
