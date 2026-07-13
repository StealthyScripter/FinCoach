import type { ForwardTestRecord } from "./contracts";
export class InMemoryForwardTestingRepository {
  private readonly records = new Map<string, ForwardTestRecord>();
  save(record: ForwardTestRecord) {
    if (!this.records.has(record.forwardTestId)) this.records.set(record.forwardTestId, record);
    return this.records.get(record.forwardTestId)!;
  }
  get(id: string) { return this.records.get(id) ?? null; }
  list() { return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.forwardTestId.localeCompare(b.forwardTestId)); }
}
