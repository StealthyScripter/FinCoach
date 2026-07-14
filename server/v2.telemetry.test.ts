import assert from "node:assert/strict";
import { deterministicFixtureEvents, fixtureManifest, ReplayVerificationService } from "./v2/replay-verification";
import { FailingV2TelemetrySink, InMemoryV2TelemetrySink, redactOperationalEvent, V2TelemetryService } from "./v2/telemetry";

const sink = new InMemoryV2TelemetrySink();
const telemetry = new V2TelemetryService(sink);

assert.equal(telemetry.counter("v2_signals_created_total", 1, { module: "signals", operation: "create", resultClass: "success" }).result, "recorded");
assert.equal(telemetry.counter("v2_signals_created_total", 1, { module: "signals", operation: "create", resultClass: "success" }).result, "recorded");
assert.equal(telemetry.counter("v2_signals_created_total", 1, { module: "signals", operation: "create", resultClass: "duplicate" }).result, "recorded");
assert.equal(telemetry.counter("v2_daily_reports_delivered_total", 1, { module: "operations", operation: "delivery", resultClass: "failure", errorClass: "delivery_failed" }).result, "recorded");
assert.equal(telemetry.counter("v2_retry_attempts_total", 1, { module: "orchestration", operation: "retry", resultClass: "failure", errorClass: "unknown_failure" }).result, "recorded");
assert.equal(telemetry.counter("v2_unsafe_label_total", 1, { module: "signals", operation: "create", correlationId: "bad" } as Record<string, string>).result, "dropped");
assert.equal(telemetry.histogram("v2_nonfinite", Number.NaN, { module: "backtesting", operation: "metrics" }).result, "dropped");

await assert.rejects(
  telemetry.time("v2_operation_duration_ms", { module: "journal", operation: "persist" }, async () => {
    throw new Error("database unavailable");
  }),
  /database unavailable/,
);
await telemetry.time("v2_operation_duration_ms", { module: "journal", operation: "persist" }, async () => "ok");

const redacted = redactOperationalEvent({
  timestamp: new Date(0).toISOString(),
  level: "error",
  module: "external-evaluation",
  operation: "ingest",
  result: "failure",
  correlationId: "corr-1",
  workerId: "worker-secret",
  details: { token: "abc", nested: { accountId: "acct-1", value: "safe" } },
});
assert.equal(redacted.details?.token, "[REDACTED]");
assert.equal((redacted.details?.nested as Record<string, unknown>).accountId, "[REDACTED]");
assert.notEqual(redacted.workerId, "worker-secret");

const replayTelemetry = new V2TelemetryService(new InMemoryV2TelemetrySink());
const replay = new ReplayVerificationService(replayTelemetry);
const manifest = fixtureManifest("artifacts/v2-replay/telemetry-test", 12);
const first = replay.run({ manifest, sourceEvents: deterministicFixtureEvents(12) });
const second = new ReplayVerificationService().run({ manifest, sourceEvents: deterministicFixtureEvents(12) });
assert.equal(first.domainEventHash, second.domainEventHash);
const replaySnapshot = replayTelemetry.snapshot();
assert.equal(replaySnapshot.counters["v2_replay_events_processed_total{module=replay,operation=verification,replayMode=verify,resultClass=passed}"], 12);
assert.equal(replaySnapshot.counters["v2_replay_domain_events_total{module=replay,operation=verification,replayMode=verify,resultClass=passed}"], first.outputEventCount);
assert.equal(replaySnapshot.gauges["v2_replay_checkpoint_count{module=replay,operation=checkpoint,replayMode=verify}"], first.checkpointCount);
assert.equal(replaySnapshot.health.state, "available");

const snapshot = telemetry.snapshot();
assert.equal(snapshot.counters["v2_signals_created_total{module=signals,operation=create,resultClass=success}"], 2);
assert.equal(snapshot.counters["v2_signals_created_total{module=signals,operation=create,resultClass=duplicate}"], 1);
assert.equal(snapshot.counters["v2_daily_reports_delivered_total{errorClass=delivery_failed,module=operations,operation=delivery,resultClass=failure}"], 1);
assert.equal(snapshot.counters["v2_retry_attempts_total{errorClass=unknown_failure,module=orchestration,operation=retry,resultClass=failure}"], 1);
assert.ok(!Object.keys(snapshot.counters).some(key => key.includes("correlationId")));
assert.equal(snapshot.health.state, "degraded");
assert.equal(snapshot.health.failureClass, "non_finite_metric");
assert.ok(snapshot.histograms["v2_operation_duration_ms{errorClass=unknown_failure,module=journal,operation=persist,resultClass=failure}"].count >= 1);
assert.ok(snapshot.histograms["v2_operation_duration_ms{module=journal,operation=persist,resultClass=success}"].count >= 1);

const failing = new V2TelemetryService(new FailingV2TelemetrySink());
assert.equal(failing.counter("v2_market_data_candles_total", 1, { module: "market-data", operation: "ingest" }).result, "dropped");
assert.equal(failing.health().state, "degraded");
assert.equal(failing.health().failureClass, "telemetry_sink_unavailable");

console.log("v2 telemetry tests passed", JSON.stringify({
  replayEvents: first.inputEventCount,
  replayOutputs: first.outputEventCount,
  checkpoints: first.checkpointCount,
  telemetryHealth: snapshot.health.state,
}));
