import { createHash, randomUUID } from "crypto";
import type { EventLogSnapshot, MarketPilotEvent } from "@shared/schema";

export type AppendEventInput = {
  type: MarketPilotEvent["type"];
  userId: string;
  sourceService: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string | null;
  createdAt?: string;
};

export class EventLogService {
  private readonly events: MarketPilotEvent[] = [];

  append(input: AppendEventInput): MarketPilotEvent {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const event: MarketPilotEvent = {
      id: randomUUID(),
      version: 1,
      type: input.type,
      correlationId: input.correlationId ?? randomUUID(),
      causationId: input.causationId ?? null,
      userId: input.userId,
      sourceService: input.sourceService,
      payloadHash: hashPayload(input.payload),
      payload: input.payload,
      createdAt,
    };
    this.events.push(event);
    return event;
  }

  list(limit = 50): MarketPilotEvent[] {
    return [...this.events].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  }

  findByCorrelation(correlationId: string): MarketPilotEvent[] {
    return this.events.filter((event) => event.correlationId === correlationId);
  }

  countByType(type: MarketPilotEvent["type"]): number {
    return this.events.filter((event) => event.type === type).length;
  }

  snapshot(now = new Date()): EventLogSnapshot {
    const latest = this.list(1)[0];
    return {
      generatedAt: now.toISOString(),
      eventCount: this.events.length,
      latestEventAt: latest?.createdAt ?? null,
      events: this.list(25),
    };
  }

  clearForTest() {
    this.events.length = 0;
  }
}

export const eventLogService = new EventLogService();

function hashPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}
