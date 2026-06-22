import { createHash } from "crypto";
import { traceService } from "./traceService";

export type OtelSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean | null>;
  status: "ok" | "error";
};

export type OtelTraceExport = {
  correlationId: string;
  generatedAt: string;
  traceId: string;
  spanCount: number;
  spans: OtelSpan[];
};

export class OtelTraceService {
  async build(correlationId: string, limit = 50): Promise<OtelTraceExport> {
    const trace = await traceService.build(correlationId, limit);
    const traceId = toTraceId(correlationId);
    const spans = trace.entries.map((entry, index) => {
      const spanId = toSpanId(entry.id);
      const parentSpanId = index === 0 ? null : toSpanId(trace.entries[index - 1].id);
      return {
        traceId,
        spanId,
        parentSpanId,
        name: entry.summary,
        startTimeUnixNano: toNanos(entry.timestamp),
        endTimeUnixNano: toNanos(entry.timestamp, 500_000_000),
        attributes: {
          correlationId: trace.correlationId,
          source: entry.source,
          sourceService: "sourceService" in entry ? entry.sourceService : null,
          action: "action" in entry ? entry.action : null,
          outcome: "outcome" in entry ? entry.outcome : null,
        },
        status: "ok" as const,
      };
    });

    return {
      correlationId,
      generatedAt: trace.generatedAt,
      traceId,
      spanCount: spans.length,
      spans,
    };
  }
}

export const otelTraceService = new OtelTraceService();

function toTraceId(input: string) {
  return createHash("sha256").update(`trace:${input}`).digest("hex").slice(0, 32);
}

function toSpanId(input: string) {
  return createHash("sha256").update(`span:${input}`).digest("hex").slice(0, 16);
}

function toNanos(timestamp: string, offsetNs = 0) {
  const millis = Date.parse(timestamp);
  const seconds = Math.floor(millis / 1000);
  const nanosWithinSecond = (millis % 1000) * 1_000_000 + offsetNs;
  const normalizedSeconds = seconds + Math.floor(nanosWithinSecond / 1_000_000_000);
  const normalizedNanos = nanosWithinSecond % 1_000_000_000;
  return `${normalizedSeconds}${String(normalizedNanos).padStart(9, "0")}`;
}
