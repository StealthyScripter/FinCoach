import type { ReplaySource, ReplaySourceBatch, ReplaySourceCursor, ReplaySourceEvent, ReplaySourceHealth } from "../replay/contracts";
import { sortReplayEvents } from "../replay/source";

export class ArrayReplaySource implements ReplaySource {
  readonly sourceId = "array";
  readonly schemaVersion = "fincoach.v2.replay-source.array.1";
  readonly readCalls: number[] = [];
  constructor(private readonly events: ReplaySourceEvent[]) {}

  async readNext(cursor: ReplaySourceCursor | null, limit: number): Promise<ReplaySourceBatch> {
    if (limit < 1) throw new Error("batch limit must be positive");
    const sorted = sortReplayEvents(this.events);
    const start = cursor?.position ?? 0;
    const batch = sorted.slice(start, start + limit);
    this.readCalls.push(batch.length);
    const last = batch.at(-1) ?? null;
    return {
      events: batch,
      cursor: last ? { schemaVersion: this.schemaVersion, sourceId: this.sourceId, position: start + batch.length, lastEventId: last.eventId, lastOrderingKey: orderingKey(last) } : cursor,
      end: start + batch.length >= sorted.length,
      readCount: batch.length,
    };
  }

  async health(): Promise<ReplaySourceHealth> {
    return { state: "available", recordCount: this.events.length, partitionCount: 1 };
  }
}

export function orderingKey(event: ReplaySourceEvent) {
  return [event.publishedAt, event.effectiveAt, String(event.priority).padStart(8, "0"), event.sourceId, event.eventId].join("|");
}
