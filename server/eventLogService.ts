import { createHash, randomUUID } from "crypto";
import type { EventLogSnapshot, MarketPilotEvent } from "@shared/schema";
import { eventLogStore, type EventLogStore } from "./eventLogStoreService";

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
  private readonly pending = new Set<Promise<unknown>>();
  private persistenceFailures = 0;
  private lastPersistenceError: string | null = null;

  constructor(private readonly store?: EventLogStore) {}

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
    if (this.store) {
      const persistence = this.store.append(event);
      this.pending.add(persistence);
      void persistence.then(
        () => this.pending.delete(persistence),
        (error) => {
          this.pending.delete(persistence);
          this.persistenceFailures += 1;
          this.lastPersistenceError = error instanceof Error ? error.message : "Event persistence failed";
        },
      );
    }
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

  exportJsonLines(limit = 1000): string {
    return this.list(limit)
      .map((event) => JSON.stringify(event))
      .join("\n")
      .concat(this.events.length > 0 ? "\n" : "");
  }

  clearForTest() {
    this.events.length = 0;
  }

  async flushPersistence() {
    await Promise.all(Array.from(this.pending));
    if (this.persistenceFailures > 0) throw new Error(this.lastPersistenceError ?? "Event persistence is incomplete");
  }

  async durableList(limit = 100_000) {
    await this.flushPersistence();
    if (!this.store) return this.list(limit);
    const persisted = await this.store.list(limit);
    const combined = new Map<string, MarketPilotEvent>();
    [...persisted, ...this.events].forEach((event) => combined.set(event.id, event));
    return Array.from(combined.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  persistenceHealth() {
    return {
      configured: Boolean(this.store),
      store: this.store?.health() ?? null,
      failureCount: this.persistenceFailures,
      lastError: this.lastPersistenceError,
    };
  }
}

export const eventLogService = new EventLogService(eventLogStore);

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
