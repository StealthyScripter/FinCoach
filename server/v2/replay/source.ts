import type { ReplaySourceEvent } from "./contracts";

export function sortReplayEvents(events: ReplaySourceEvent[]) {
  return [...events].sort((a, b) =>
    a.publishedAt.localeCompare(b.publishedAt)
    || a.effectiveAt.localeCompare(b.effectiveAt)
    || a.priority - b.priority
    || a.sourceId.localeCompare(b.sourceId)
    || a.eventId.localeCompare(b.eventId));
}

export function visibleAt(event: ReplaySourceEvent, replayTime: string) {
  return event.publishedAt <= replayTime && event.effectiveAt <= replayTime;
}
