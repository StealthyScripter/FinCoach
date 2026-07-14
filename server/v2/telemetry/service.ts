import { createHash } from "crypto";
import type { V2MetricKind, V2MetricLabels, V2MetricSample, V2OperationalEvent, V2TelemetryHealth, V2TelemetryRecordResult, V2TelemetrySink, V2TelemetrySnapshot } from "./contracts";

const allowedLabelKeys = new Set(["module", "operation", "eventType", "resultClass", "errorClass", "schemaVersion", "timeframe", "assetClass", "lifecycleState", "courtroomVerdict", "rejectionCategory", "replayMode", "workerType"]);
const forbiddenLabelKeys = /(^|_)(eventId|correlationId|causationId|strategyId|signalId|accountId|token|secret|message|userInput|rawSymbol)$/i;

export class InMemoryV2TelemetrySink implements V2TelemetrySink {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { count: number; min: number; max: number; sum: number }>();
  private recentEvents: V2OperationalEvent[] = [];
  private telemetryHealth: V2TelemetryHealth = { state: "available", lastSuccessfulRecordAt: null, lastFailedRecordAt: null, failureClass: null, droppedMetrics: 0 };

  record(sample: V2MetricSample): void {
    validateSample(sample);
    const key = metricKey(sample.name, sample.labels);
    if (sample.kind === "counter") this.counters.set(key, (this.counters.get(key) ?? 0) + sample.value);
    if (sample.kind === "gauge") this.gauges.set(key, sample.value);
    if (sample.kind === "histogram") {
      const previous = this.histograms.get(key) ?? { count: 0, min: sample.value, max: sample.value, sum: 0 };
      this.histograms.set(key, { count: previous.count + 1, min: Math.min(previous.min, sample.value), max: Math.max(previous.max, sample.value), sum: previous.sum + sample.value });
    }
    this.telemetryHealth = { ...this.telemetryHealth, state: this.telemetryHealth.droppedMetrics ? "degraded" : "available", lastSuccessfulRecordAt: sample.recordedAt };
  }

  event(event: V2OperationalEvent): void {
    this.recentEvents.push(redactOperationalEvent(event));
    this.recentEvents = this.recentEvents.slice(-50);
    this.telemetryHealth = { ...this.telemetryHealth, state: this.telemetryHealth.droppedMetrics ? "degraded" : "available", lastSuccessfulRecordAt: event.timestamp };
  }

  snapshot(): V2TelemetrySnapshot {
    return {
      schemaVersion: "fincoach.v2.telemetry-snapshot.1",
      health: this.health(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
      recentEvents: [...this.recentEvents],
    };
  }

  health(): V2TelemetryHealth {
    return { ...this.telemetryHealth };
  }

  markDropped(errorClass: string) {
    this.telemetryHealth = { state: "degraded", lastSuccessfulRecordAt: this.telemetryHealth.lastSuccessfulRecordAt, lastFailedRecordAt: new Date().toISOString(), failureClass: errorClass, droppedMetrics: this.telemetryHealth.droppedMetrics + 1 };
  }
}

export class FailingV2TelemetrySink implements V2TelemetrySink {
  private droppedMetrics = 0;
  record(): void {
    this.droppedMetrics += 1;
    throw new Error("telemetry sink unavailable");
  }
  event(): void {
    this.droppedMetrics += 1;
    throw new Error("telemetry sink unavailable");
  }
  snapshot(): V2TelemetrySnapshot {
    return { schemaVersion: "fincoach.v2.telemetry-snapshot.1", health: this.health(), counters: {}, gauges: {}, histograms: {}, recentEvents: [] };
  }
  health(): V2TelemetryHealth {
    return { state: "degraded", lastSuccessfulRecordAt: null, lastFailedRecordAt: new Date().toISOString(), failureClass: "telemetry_sink_unavailable", droppedMetrics: this.droppedMetrics };
  }
}

export class V2TelemetryService {
  constructor(private readonly sink: V2TelemetrySink = new InMemoryV2TelemetrySink()) {}

  counter(name: string, value: number, labels: V2MetricLabels): V2TelemetryRecordResult {
    return this.record("counter", name, value, labels);
  }

  gauge(name: string, value: number, labels: V2MetricLabels): V2TelemetryRecordResult {
    return this.record("gauge", name, value, labels);
  }

  histogram(name: string, value: number, labels: V2MetricLabels): V2TelemetryRecordResult {
    return this.record("histogram", name, value, labels);
  }

  async time<T>(name: string, labels: V2MetricLabels, operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const result = await operation();
      this.histogram(name, Date.now() - started, { ...labels, resultClass: "success" });
      return result;
    } catch (error) {
      this.histogram(name, Date.now() - started, { ...labels, resultClass: "failure", errorClass: classifyTelemetryError(error) });
      throw error;
    }
  }

  operationalEvent(event: Omit<V2OperationalEvent, "timestamp"> & { timestamp?: string }): V2TelemetryRecordResult {
    try {
      this.sink.event({ ...event, timestamp: event.timestamp ?? new Date().toISOString() });
      return { result: "recorded" };
    } catch (error) {
      markSinkDropped(this.sink, classifyTelemetryError(error));
      return { result: "dropped", errorClass: classifyTelemetryError(error) };
    }
  }

  snapshot(): V2TelemetrySnapshot {
    return this.sink.snapshot();
  }

  health() {
    return this.sink.health();
  }

  private record(kind: V2MetricKind, name: string, value: number, labels: V2MetricLabels): V2TelemetryRecordResult {
    try {
      this.sink.record({ name, kind, value, labels, recordedAt: new Date().toISOString() });
      return { result: "recorded" };
    } catch (error) {
      markSinkDropped(this.sink, classifyTelemetryError(error));
      return { result: "dropped", errorClass: classifyTelemetryError(error) };
    }
  }
}

export function redactOperationalEvent(event: V2OperationalEvent): V2OperationalEvent {
  return {
    ...event,
    workerId: event.workerId ? hashSensitive(event.workerId) : undefined,
    details: redactValue(event.details ?? {}) as Record<string, unknown>,
  };
}

function validateSample(sample: V2MetricSample) {
  if (!Number.isFinite(sample.value)) throw new Error("non_finite_metric");
  for (const [key, value] of Object.entries(sample.labels)) {
    if (!allowedLabelKeys.has(key) || forbiddenLabelKeys.test(key)) throw new Error(`unsafe_metric_label:${key}`);
    if (typeof value !== "string" || value.length > 64) throw new Error(`unsafe_metric_label_value:${key}`);
  }
}

function metricKey(name: string, labels: V2MetricLabels) {
  return `${name}{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(",")}}`;
}

function markSinkDropped(sink: V2TelemetrySink, errorClass: string) {
  if (sink instanceof InMemoryV2TelemetrySink) sink.markDropped(errorClass);
}

function classifyTelemetryError(error: unknown) {
  if (error instanceof Error && /unsafe_metric_label/.test(error.message)) return "unsafe_metric_label";
  if (error instanceof Error && /non_finite_metric/.test(error.message)) return "non_finite_metric";
  if (error instanceof Error && /sink unavailable/.test(error.message)) return "telemetry_sink_unavailable";
  return "unknown_failure";
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return typeof value === "string" && /token|secret|key|account|telegram|password/i.test(value) ? "[REDACTED]" : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (/token|secret|password|credential|connection|string|accountId|chatId/i.test(key)) return [key, "[REDACTED]"];
    return [key, redactValue(child)];
  }));
}

function hashSensitive(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export const v2TelemetryService = new V2TelemetryService();
