import type { MarketPilotEvent } from "@shared/schema";
import { Pool } from "pg";

export interface EventLogStore {
  append(event: MarketPilotEvent): Promise<MarketPilotEvent>;
  list(limit?: number): Promise<MarketPilotEvent[]>;
  health(): { provider: "memory" | "postgres"; status: "healthy" | "disabled"; events: number };
  close?(): Promise<void>;
}

export class InMemoryEventLogStore implements EventLogStore {
  private events: MarketPilotEvent[] = [];
  async append(event: MarketPilotEvent) {
    this.events.push(event);
    return event;
  }
  async list(limit = 50) {
    return [...this.events].slice(-limit).reverse();
  }
  health(): ReturnType<EventLogStore["health"]> {
    return { provider: "memory" as const, status: "healthy" as const, events: this.events.length };
  }
}

export class PgEventLogStore implements EventLogStore {
  private readonly pool: Pool | null;
  private persistedEvents = 0;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async append(event: MarketPilotEvent) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO marketpilot_events
        (id, version, type, correlation_id, causation_id, user_id, source_service, payload_hash, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id, event.version, event.type, event.correlationId, event.causationId,
        event.userId, event.sourceService, event.payloadHash, JSON.stringify(event.payload), event.createdAt,
      ],
    );
    this.persistedEvents += 1;
    return event;
  }

  async list(limit = 50) {
    if (!this.pool) return [];
    const response = await this.pool.query(
      `SELECT * FROM marketpilot_events ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return response.rows.map((row) => ({
      id: String(row.id),
      version: 1 as const,
      type: row.type,
      correlationId: String(row.correlation_id),
      causationId: row.causation_id ? String(row.causation_id) : null,
      userId: String(row.user_id),
      sourceService: String(row.source_service),
      payloadHash: String(row.payload_hash),
      payload: row.payload,
      createdAt: new Date(row.created_at).toISOString(),
    })) as MarketPilotEvent[];
  }

  health(): ReturnType<EventLogStore["health"]> {
    return {
      provider: "postgres" as const,
      status: this.pool ? "healthy" as const : "disabled" as const,
      events: this.persistedEvents,
    };
  }

  async close() {
    await this.pool?.end();
  }
}

export const eventLogStore: EventLogStore = process.env.DATABASE_URL ? new PgEventLogStore() : new InMemoryEventLogStore();
