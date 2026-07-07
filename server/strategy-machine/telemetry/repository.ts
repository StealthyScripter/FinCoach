import type { TelemetrySnapshot } from "./contracts";

export class TelemetryRepository {
  private snapshots: TelemetrySnapshot[] = [];

  save(snapshot: TelemetrySnapshot) {
    this.snapshots.push(JSON.parse(JSON.stringify(snapshot)) as TelemetrySnapshot);
    return snapshot;
  }
}
