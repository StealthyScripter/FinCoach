import assert from "node:assert/strict";
import { deterministicFixtureEvents, fixtureManifest, ReplayVerificationService, validateReplayResult, requiredReplayArtifacts } from "./v2/replay-verification";
import { InMemoryV2TelemetrySink, V2TelemetryService } from "./v2/telemetry";

const telemetry = new V2TelemetryService(new InMemoryV2TelemetrySink());
const service = new ReplayVerificationService(telemetry);
const manifest = fixtureManifest("artifacts/v2-replay/operational-maturity", 12);
const uninterrupted = service.run({ manifest, sourceEvents: deterministicFixtureEvents(12), writeArtifacts: true });
const restarted = service.run({ manifest, sourceEvents: deterministicFixtureEvents(12) });

assert.equal(uninterrupted.status, "passed");
assert.equal(uninterrupted.domainEventHash, restarted.domainEventHash);
assert.equal(validateReplayResult(uninterrupted, requiredReplayArtifacts()).ok, true);
assert.equal(uninterrupted.safety.liveExecutionBlocked, true);
assert.equal(uninterrupted.safety.brokerCalls, 0);
assert.equal(uninterrupted.safety.telegramMessages, 0);

const snapshot = telemetry.snapshot();
assert.equal(snapshot.counters["v2_replay_events_processed_total{module=replay,operation=verification,replayMode=verify,resultClass=passed}"], 24);
assert.equal(snapshot.gauges["v2_replay_checkpoint_count{module=replay,operation=checkpoint,replayMode=verify}"], uninterrupted.checkpointCount);

console.log("v2 operational maturity integration tests passed", JSON.stringify({
  deterministic: true,
  checkpoints: uninterrupted.checkpointCount,
  liveExecutionBlocked: uninterrupted.safety.liveExecutionBlocked,
}));
