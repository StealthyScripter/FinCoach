import assert from "node:assert/strict";
import { existsSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { deterministicFixtureEvents, fixtureManifest, hashReplayManifest, ReplayVerificationService, requiredReplayArtifacts, validateReplayManifest, validateReplayResult } from "./v2/replay-verification";

const outputDirectory = "artifacts/v2-replay/test-short";
rmSync(outputDirectory, { recursive: true, force: true });

const manifest = fixtureManifest(outputDirectory, 12);
const hash = hashReplayManifest(manifest);
assert.equal(hash.length, 64);
assert.equal(validateReplayManifest(manifest).runId, "fixture-12");
assert.throws(() => validateReplayManifest({ ...manifest, manifestVersion: "bad" }), /Invalid literal/);
assert.throws(() => validateReplayManifest({ ...manifest, endTime: manifest.startTime }), /endTime/);
assert.throws(() => validateReplayManifest({ ...manifest, seed: -1 }), /seed/);

const service = new ReplayVerificationService();
const first = service.run({ manifest, sourceEvents: deterministicFixtureEvents(12), writeArtifacts: true });
const second = service.run({ manifest, sourceEvents: deterministicFixtureEvents(12) });
assert.equal(first.status, "passed");
assert.equal(first.domainEventHash, second.domainEventHash);
assert.equal(first.inputEventCount, 12);
assert.equal(first.checkpointCount, 4);
assert.equal(first.restartCount, 2);
assert.equal(first.safety.liveExecutionBlocked, true);
assert.equal(first.safety.brokerCalls, 0);
assert.equal(first.safety.telegramMessages, 0);
assert.ok(first.peakHeapMb > 0);

for (const artifact of requiredReplayArtifacts()) {
  assert.equal(existsSync(`${outputDirectory}/${artifact}`), true, `${artifact} should exist`);
}
assert.equal(validateReplayResult(first, requiredReplayArtifacts()).ok, true);
assert.equal(validateReplayResult({ ...first, safety: { liveExecutionBlocked: true, brokerCalls: 1, telegramMessages: 0 } }, requiredReplayArtifacts()).ok, false);
assert.equal(service.run({ manifest: { ...manifest, datasetHashes: { fixture: "0".repeat(64) } }, sourceEvents: deterministicFixtureEvents(12) }).status, "failed");

const mediumManifest = fixtureManifest("artifacts/v2-replay/test-medium", 48);
const medium = service.run({ manifest: mediumManifest, sourceEvents: deterministicFixtureEvents(48) });
assert.equal(medium.status, "passed");
assert.equal(medium.inputEventCount, 48);
assert.equal(medium.checkpointCount, 16);

const ignored = execFileSync("git", ["check-ignore", "artifacts/v2-replay/test-short/summary.json"], { encoding: "utf8" }).trim();
assert.equal(ignored, "artifacts/v2-replay/test-short/summary.json");

console.log("v2 replay verification tests passed", JSON.stringify({
  short: { events: first.inputEventCount, output: first.outputEventCount, checkpoints: first.checkpointCount, peakHeapMb: first.peakHeapMb },
  medium: { events: medium.inputEventCount, output: medium.outputEventCount, checkpoints: medium.checkpointCount, peakHeapMb: medium.peakHeapMb },
}));
