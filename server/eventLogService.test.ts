import assert from "node:assert/strict";
import { eventLogSnapshotSchema, marketPilotEventSchema } from "@shared/schema";
import { eventLogService } from "./eventLogService";

eventLogService.clearForTest();
const event = eventLogService.append({
  type: "trade.ticket_created",
  userId: "user-demo",
  sourceService: "execution-service",
  correlationId: "corr-1",
  payload: { ticketId: "ticket-1", asset: "SPY" },
  createdAt: "2026-01-15T14:00:00.000Z",
});

marketPilotEventSchema.parse(event);
assert.equal(event.version, 1);
assert.equal(event.correlationId, "corr-1");
assert.equal(event.causationId, null);
assert.equal(event.payloadHash.length, 64);
assert.equal(eventLogService.findByCorrelation("corr-1").length, 1);
assert.equal(eventLogService.countByType("trade.ticket_created"), 1);

const snapshot = eventLogService.snapshot(new Date("2026-01-15T14:01:00.000Z"));
eventLogSnapshotSchema.parse(snapshot);
assert.equal(snapshot.eventCount, 1);
assert.equal(snapshot.latestEventAt, "2026-01-15T14:00:00.000Z");

console.log("eventLogService smoke tests passed");
