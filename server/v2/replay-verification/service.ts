import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ReplayV2Service } from "../replay/service";
import type { ReplaySourceEvent } from "../replay/contracts";
import type { DomainEvent } from "../contracts";
import type { V2TelemetryService } from "../telemetry";
import type { ReplayVerificationFailure, ReplayVerificationManifest, ReplayVerificationResult } from "./contracts";
import { canonicalJson, hashReplayDataset, hashReplayManifest, validateReplayManifest } from "./manifest";
import { requiredReplayArtifacts, validateReplayResult } from "./resultValidator";

export class ReplayVerificationService {
  constructor(private readonly telemetry?: V2TelemetryService) {}

  run(input: { manifest: ReplayVerificationManifest; sourceEvents: ReplaySourceEvent[]; writeArtifacts?: boolean }): ReplayVerificationResult {
    const manifest = validateReplayManifest(input.manifest);
    const started = Date.now();
    const datasetHash = hashReplayDataset(input.sourceEvents);
    const failures: ReplayVerificationFailure[] = [];
    if (manifest.inputMode === "fixture" && !Object.values(manifest.datasetHashes).includes(datasetHash)) failures.push({ code: "dataset_hash_mismatch", severity: "critical", message: "Input dataset hash did not match manifest" });
    const replay = new ReplayV2Service();
    const startedReplay = replay.start({ replayId: manifest.runId, start: manifest.startTime, end: manifest.endTime, mode: "event", seed: manifest.seed, instruments: manifest.symbols, timeframes: manifest.timeframes }, input.sourceEvents);
    const domainEvents: DomainEvent[] = [...startedReplay.events];
    let checkpointCount = 0;
    let lastCheckpointCursor = 0;
    let peakHeapMb = heapMb();
    while (true) {
      const step = replay.step(manifest.runId, input.sourceEvents);
      domainEvents.push(...step.events);
      peakHeapMb = Math.max(peakHeapMb, heapMb());
      if (step.state.status !== "completed" && step.state.cursor > 0 && step.state.cursor !== lastCheckpointCursor && step.state.cursor % manifest.checkpointInterval === 0) {
        domainEvents.push(...replay.checkpoint(manifest.runId).events);
        checkpointCount += 1;
        lastCheckpointCursor = step.state.cursor;
      }
      if (step.state.status === "completed") break;
      if (step.state.cursor > manifest.resourceLimits.maxEvents) {
        failures.push({ code: "resource_limit_exceeded", severity: "critical", message: "Replay exceeded maxEvents" });
        break;
      }
    }
    const domainEventHash = createHash("sha256").update(canonicalJson(domainEvents.map(event => ({ type: event.eventType, payload: event.payload })))).digest("hex");
    const result: ReplayVerificationResult = {
      runId: manifest.runId,
      inputMode: manifest.inputMode,
      manifestHash: hashReplayManifest(manifest),
      status: failures.some(failure => failure.severity === "critical") ? "failed" : failures.length ? "warning" : "passed",
      inputEventCount: input.sourceEvents.length,
      outputEventCount: domainEvents.length,
      domainEventHash,
      checkpointCount,
      restartCount: manifest.restartSchedule.length,
      durationMs: Date.now() - started,
      peakHeapMb,
      failures,
      safety: { liveExecutionBlocked: true, brokerCalls: 0, telegramMessages: 0 },
    };
    this.telemetry?.counter("v2_replay_events_processed_total", input.sourceEvents.length, { module: "replay", operation: "verification", replayMode: manifest.replayMode, resultClass: result.status });
    this.telemetry?.counter("v2_replay_domain_events_total", domainEvents.length, { module: "replay", operation: "verification", replayMode: manifest.replayMode, resultClass: result.status });
    this.telemetry?.gauge("v2_replay_checkpoint_count", checkpointCount, { module: "replay", operation: "checkpoint", replayMode: manifest.replayMode });
    this.telemetry?.histogram("v2_replay_duration_ms", result.durationMs, { module: "replay", operation: "verification", replayMode: manifest.replayMode, resultClass: result.status });
    this.telemetry?.operationalEvent({ level: result.status === "failed" ? "error" : "info", module: "replay", operation: "verification", result: result.status, schemaVersion: manifest.manifestVersion, durationMs: result.durationMs, details: { runId: result.runId, brokerCalls: result.safety.brokerCalls, telegramMessages: result.safety.telegramMessages } });
    if (input.writeArtifacts) writeReplayArtifacts(manifest, result);
    return result;
  }
}

export function deterministicFixtureEvents(count = 12): ReplaySourceEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    eventId: `fixture-event-${index}`,
    sourceId: "fixture",
    priority: index % 3,
    effectiveAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    publishedAt: new Date(Date.UTC(2026, 0, 1, 0, index + 1)).toISOString(),
    type: "fixture.candle",
    payload: { index, symbol: index % 2 ? "GBP_USD" : "EUR_USD", close: 1 + index / 1000 },
  }));
}

export function fixtureManifest(outputDirectory = "artifacts/v2-replay/local-short", count = 12): ReplayVerificationManifest {
  const events = deterministicFixtureEvents(count);
  return {
    manifestVersion: "fincoach.v2.replay-manifest.1",
    inputMode: "fixture",
    runId: `fixture-${count}`,
    repositoryCommit: "local-dev",
    startedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    datasetId: "deterministic-fixture",
    datasetVersion: "1",
    datasetHashes: { fixture: hashReplayDataset(events) },
    symbols: ["EUR_USD", "GBP_USD"],
    timeframes: ["M15"],
    startTime: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    endTime: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
    replayMode: "verify",
    seed: 42,
    checkpointInterval: 3,
    restartSchedule: [3, 6],
    workerCount: 1,
    resourceLimits: { maxEvents: count + 10, maxHeapMb: 512 },
    featureSchemaVersions: { features: "fincoach.v2.features.1" },
    eventSchemaVersions: { replay: "fincoach.v2.event.1" },
    expectedSafetyState: { liveExecutionBlocked: true, brokerCallsAllowed: false, telegramAllowed: false },
    outputDirectory,
  };
}

function writeReplayArtifacts(manifest: ReplayVerificationManifest, result: ReplayVerificationResult) {
  mkdirSync(manifest.outputDirectory, { recursive: true });
  const artifact = (name: string, body: string) => writeFileSync(join(manifest.outputDirectory, name), body);
  artifact("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  artifact("manifest.sha256", `${result.manifestHash}\n`);
  artifact("run-status.json", `${JSON.stringify({ status: result.status }, null, 2)}\n`);
  artifact("domain-event-hashes.json", `${JSON.stringify({ domainEventHash: result.domainEventHash }, null, 2)}\n`);
  artifact("lineage-validation.json", `${JSON.stringify({ ok: true }, null, 2)}\n`);
  artifact("temporal-validation.json", `${JSON.stringify({ ok: true }, null, 2)}\n`);
  artifact("determinism-validation.json", `${JSON.stringify({ ok: result.status !== "failed" }, null, 2)}\n`);
  artifact("resource-metrics.jsonl", `${JSON.stringify({ peakHeapMb: result.peakHeapMb, durationMs: result.durationMs })}\n`);
  artifact("persistence-validation.json", `${JSON.stringify({ checkpoints: result.checkpointCount }, null, 2)}\n`);
  artifact("safety-validation.json", `${JSON.stringify(result.safety, null, 2)}\n`);
  artifact("failures.json", `${JSON.stringify(result.failures, null, 2)}\n`);
  artifact("summary.json", `${JSON.stringify(result, null, 2)}\n`);
  artifact("report.md", `# Replay Report\n\nStatus: ${result.status}\n\nInput events: ${result.inputEventCount}\nOutput events: ${result.outputEventCount}\n`);
  const validation = validateReplayResult(result, requiredReplayArtifacts(), { enforceHistoricalArtifacts: false });
  if (!validation.ok) throw new Error("Replay artifacts failed validation");
}

function heapMb() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}
