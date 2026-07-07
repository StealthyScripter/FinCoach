import type { EventEnvelope, StrategyMachineModule } from "./contracts";

export class InMemoryEventRepository {
  private readonly events = new Map<string, EventEnvelope>();

  append(event: EventEnvelope) {
    if (this.events.has(event.id)) throw new Error(`Event already exists: ${event.id}`);
    this.events.set(event.id, event);
    return event;
  }

  list(module?: StrategyMachineModule) {
    return Array.from(this.events.values())
      .filter((event) => !module || event.module === module)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }

  find(id: string) {
    return this.events.get(id) ?? null;
  }

  clearForTest() {
    this.events.clear();
  }
}

export const strategyMachineEventRepository = new InMemoryEventRepository();
