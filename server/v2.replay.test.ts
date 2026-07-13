import assert from "node:assert/strict";
import { InMemoryReplayRepository, ReplayV2EventTypes, ReplayV2Service, sortReplayEvents, type ReplaySourceEvent } from "./v2/replay";

const source: ReplaySourceEvent[] = [
  { eventId: "b", sourceId: "calendar", priority: 2, effectiveAt: "2026-01-01T10:00:00.000Z", publishedAt: "2026-01-01T10:00:00.000Z", type: "economic", payload: {} },
  { eventId: "a", sourceId: "candle", priority: 1, effectiveAt: "2026-01-01T10:00:00.000Z", publishedAt: "2026-01-01T10:00:00.000Z", type: "candle", payload: {} },
  { eventId: "future", sourceId: "revision", priority: 1, effectiveAt: "2026-01-01T09:00:00.000Z", publishedAt: "2026-01-02T09:00:00.000Z", type: "revision", payload: {} },
];
assert.deepEqual(sortReplayEvents(source).map((event) => event.eventId), ["a", "b", "future"]);

const repo = new InMemoryReplayRepository();
const service = new ReplayV2Service(repo);
const config = { replayId: "replay-1", start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T23:00:00.000Z", mode: "step" as const, seed: 7, instruments: ["EUR_USD"], timeframes: ["1h"] };
const started = service.start(config, source);
assert.equal(started.events[0].eventType, ReplayV2EventTypes.ReplayStarted);
const first = service.step(config.replayId, source);
assert.equal(first.delivered[0].eventId, "a");
const checkpoint = service.checkpoint(config.replayId).checkpoint;
assert.equal(checkpoint.cursor, 1);
const second = service.step(config.replayId, source);
assert.equal(second.delivered[0].eventId, "b");

const resumedService = new ReplayV2Service(new InMemoryReplayRepository());
resumedService.resume({ ...service.get(config.replayId)!, cursor: checkpoint.cursor, clock: checkpoint.clock, deliveredEventIds: checkpoint.deliveredEventIds });
const resumedSecond = resumedService.step(config.replayId, source);
assert.equal(resumedSecond.delivered[0].eventId, "b");

const repeated = new ReplayV2Service(new InMemoryReplayRepository());
repeated.start(config, source);
assert.deepEqual([repeated.step(config.replayId, source).delivered[0].eventId, repeated.step(config.replayId, source).delivered[0].eventId], ["a", "b"]);
service.pause(config.replayId);
assert.throws(() => service.step(config.replayId, source), /not running/);
assert.equal("submitOrder" in service, false);
console.log("v2 phase 6 replay tests passed");
