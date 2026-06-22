import type { MarketPilotEvent } from "@shared/schema";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";

export type TraceEntry =
  | {
      source: "event_log";
      id: string;
      correlationId: string;
      timestamp: string;
      summary: string;
      sourceService: string;
      detail: Record<string, unknown>;
    }
  | {
      source: "execution_audit";
      id: string;
      correlationId: string;
      timestamp: string;
      summary: string;
      action: string;
      outcome: string;
      detail: Record<string, unknown>;
    };

export type TraceReport = {
  correlationId: string;
  generatedAt: string;
  entryCount: number;
  eventCount: number;
  auditCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  entries: TraceEntry[];
};

export class TraceService {
  async build(correlationId: string, limit = 50): Promise<TraceReport> {
    const [events, audits] = await Promise.all([
      eventLogService.durableList(limit * 2),
      executionAuditLog.durableList(),
    ]);

    const eventEntries = events
      .filter((event) => event.correlationId === correlationId)
      .map((event) => eventEntry(event));
    const auditEntries = audits
      .filter((entry) => entry.correlationId === correlationId)
      .map((entry) => auditEntry(entry));

    const entries = [...eventEntries, ...auditEntries]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(0, limit);
    const firstSeenAt = entries[0]?.timestamp ?? null;
    const lastSeenAt = entries.at(-1)?.timestamp ?? null;

    return {
      correlationId,
      generatedAt: new Date().toISOString(),
      entryCount: entries.length,
      eventCount: eventEntries.length,
      auditCount: auditEntries.length,
      firstSeenAt,
      lastSeenAt,
      entries,
    };
  }
}

export const traceService = new TraceService();

function eventEntry(event: MarketPilotEvent): TraceEntry {
  return {
    source: "event_log",
    id: event.id,
    correlationId: event.correlationId,
    timestamp: event.createdAt,
    summary: `${event.type} via ${event.sourceService}`,
    sourceService: event.sourceService,
    detail: event.payload,
  };
}

function auditEntry(entry: Awaited<ReturnType<typeof executionAuditLog.durableList>>[number]): TraceEntry {
  return {
    source: "execution_audit",
    id: entry.id,
    correlationId: entry.correlationId,
    timestamp: entry.createdAt,
    summary: `${entry.action} -> ${entry.outcome}`,
    action: entry.action,
    outcome: entry.outcome,
    detail: entry.detail,
  };
}
