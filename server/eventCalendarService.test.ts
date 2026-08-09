import assert from "node:assert/strict";
import { EventCalendarService } from "./eventCalendarService";
import { marketSnapshotService } from "./marketSnapshotService";

const service = new EventCalendarService();
const now = new Date("2026-06-15T12:00:00.000Z");

const events = service.getUpcomingEvents(now);
assert.equal(events.length, 3);
assert.ok(events.some((event) => event.id === "event-cpi"));
assert.ok(events.every((event) => event.sourceType === "synthetic_demo"));
assert.ok(events.every((event) => event.authoritative === false));
assert.equal(service.getUpcomingEvents(new Date("2026-06-15T13:00:00.000Z"))[0].startsAt, "2026-06-16T13:00:00.000Z");

const relevant = service.getRelevantEvents("VTI", now);
assert.ok(relevant.length >= 2);

const blockers = service.getBlockingEvents("VTI", now);
assert.equal(blockers.length, 1);
assert.equal(blockers[0].impact, "high");

const snapshotEvents = marketSnapshotService.upcomingEvents(now);
assert.ok(snapshotEvents.length > 0);
assert.ok(snapshotEvents.every((item) => item.source === "synthetic_demo"));
assert.ok(snapshotEvents.every((item) => item.event.authoritative === false));

console.log("eventCalendarService smoke tests passed");
