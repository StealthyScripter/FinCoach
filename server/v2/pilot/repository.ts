import type { DemoResearchPilotRecord } from "./contracts";

export class InMemoryDemoResearchPilotRepository {
  private readonly pilots = new Map<string, DemoResearchPilotRecord>();

  constructor(seed: readonly DemoResearchPilotRecord[] = []) {
    for (const pilot of seed) this.pilots.set(pilot.pilotId, freezeRecord(pilot));
  }

  save(record: DemoResearchPilotRecord) {
    const frozen = freezeRecord(record);
    this.pilots.set(record.pilotId, frozen);
    return frozen;
  }

  get(pilotId: string) {
    return this.pilots.get(pilotId) ?? null;
  }

  list() {
    return [...this.pilots.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.pilotId.localeCompare(b.pilotId));
  }

  snapshot() {
    return this.list();
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
