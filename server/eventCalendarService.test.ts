import assert from "node:assert/strict";
import { EventCalendarService } from "./eventCalendarService";

const service = new EventCalendarService();
const now = new Date("2026-06-15T12:00:00.000Z");

const events = service.getUpcomingEvents(now);
assert.equal(events.length, 3);
assert.ok(events.some((event) => event.id === "event-cpi"));

const relevant = service.getRelevantEvents("VTI", now);
assert.ok(relevant.length >= 2);

const blockers = service.getBlockingEvents("VTI", now);
assert.equal(blockers.length, 1);
assert.equal(blockers[0].impact, "high");

console.log("eventCalendarService smoke tests passed");
