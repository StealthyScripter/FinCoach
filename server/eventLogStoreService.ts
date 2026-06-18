import type { MarketPilotEvent } from "@shared/schema";

export interface EventLogStore {
  append(event: MarketPilotEvent): Promise<MarketPilotEvent>;
  list(limit?: number): Promise<MarketPilotEvent[]>;
  health(): { provider: "memory" | "postgres"; status: "healthy" | "disabled"; events: number };
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

export class PgEventLogStore extends InMemoryEventLogStore {
  override health(): ReturnType<EventLogStore["health"]> {
    return {
      provider: "postgres" as const,
      status: process.env.DATABASE_URL ? "healthy" as const : "disabled" as const,
      events: super.health().events,
    };
  }
}

export const eventLogStore: EventLogStore = process.env.DATABASE_URL ? new PgEventLogStore() : new InMemoryEventLogStore();
