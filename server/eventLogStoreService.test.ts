import assert from "node:assert/strict";
import { marketPilotEventSchema } from "@shared/schema";
import { InMemoryEventLogStore, PgEventLogStore } from "./eventLogStoreService";
import { eventLogService } from "./eventLogService";

const event = eventLogService.append({
  type: "security.posture_updated",
  userId: "user-demo",
  sourceService: "security-service",
  correlationId: "corr-store",
  payload: { status: "healthy" },
  createdAt: "2026-01-15T14:00:00.000Z",
});
marketPilotEventSchema.parse(event);

const store = new InMemoryEventLogStore();
await store.append(event);
const events = await store.list();
assert.equal(events.length, 1);
assert.equal(events[0].correlationId, "corr-store");
assert.equal(store.health().provider, "memory");

const pg = new PgEventLogStore();
assert.ok(["disabled", "healthy"].includes(pg.health().status));

console.log("eventLogStoreService smoke tests passed");
