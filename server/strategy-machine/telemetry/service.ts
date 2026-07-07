import { createEvent, type EventEnvelope, type EventReference } from "../core";
import { TelemetryEventTypes } from "./events";
import type { TelemetrySnapshot } from "./contracts";
import { TelemetryRepository } from "./repository";

export class TelemetryService {
  constructor(private readonly repository = new TelemetryRepository()) {}

  snapshot(events: EventEnvelope[], now = new Date()) {
    const refs = events.slice(-25).map(referenceFrom);
    const latest = events.reduce((max, event) => Math.max(max, Date.parse(event.occurredAt)), 0);
    const validationPassCount = count(events, ["ExperimentValidated", "ExperimentReadyForForwardTest"]);
    const validationFailCount = count(events, ["ExperimentRejected", "ExperimentNeedsMoreData"]);
    const safetyBlocks = events.filter((event) => JSON.stringify(event.payload).includes("blocked")).length;
    const snapshot: TelemetrySnapshot = {
      generatedAt: now.toISOString(),
      dataFreshnessSeconds: latest ? Math.max(0, Math.floor((now.getTime() - latest) / 1000)) : Number.MAX_SAFE_INTEGER,
      patternDetectorThroughput: count(events, ["PatternDetected", "PatternRejected"]),
      hypothesisCreationCount: count(events, ["HypothesisCreated"]),
      experimentThroughput: count(events, ["ExperimentCreated", "ExperimentStateChanged"]),
      backtestQueueHealth: count(events, ["BacktestFailed"]) > 0 ? "degraded" : "healthy",
      validationPassCount,
      validationFailCount,
      forwardTestHealth: count(events, ["ForwardTestStarted"]) > 0 && count(events, ["ForwardTestPaused"]) === 0 ? "healthy" : count(events, ["ForwardTestPaused"]) > 0 ? "paused" : "blocked",
      journalCompletionRate: rate(count(events, ["TradeReviewed"]), count(events, ["TradeJournalCreated"])),
      demoExecutionSafetyBlocks: safetyBlocks,
      providerReliability: { mock: 1, paper_provider: 1 },
      oandaPracticeApiReliability: null,
      telegramControlReliability: null,
      sourceEventRefs: refs,
    };
    this.repository.save(snapshot);
    return createEvent({ type: TelemetryEventTypes.TelemetrySnapshotCreated, module: "telemetry", payload: snapshot as unknown as Record<string, unknown>, sourceEventRefs: refs });
  }

  healthChanged(snapshotEvent: EventEnvelope<TelemetrySnapshot>) {
    const snapshot = snapshotEvent.payload;
    const status = snapshot.dataFreshnessSeconds > 3600 || snapshot.backtestQueueHealth !== "healthy" ? "degraded" : "healthy";
    return createEvent({ type: TelemetryEventTypes.ResearchPipelineHealthChanged, module: "telemetry", payload: { status, generatedAt: snapshot.generatedAt }, sourceEventRefs: [referenceFrom(snapshotEvent)] });
  }
}

function count(events: EventEnvelope[], types: string[]) {
  return events.filter((event) => types.includes(event.type)).length;
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function referenceFrom(event: EventEnvelope): EventReference {
  return { eventId: event.id, eventType: event.type, module: event.module, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt };
}

export const telemetryService = new TelemetryService();
