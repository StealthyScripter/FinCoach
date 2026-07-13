import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ReplayConfig, ReplaySourceEvent, ReplayState } from "./contracts";
import { ReplayV2EventTypes } from "./events";
import { ReplayClock } from "./replayClock";
import { InMemoryReplayRepository } from "./repository";
import { sortReplayEvents, visibleAt } from "./source";

export class ReplayV2Service {
  constructor(private readonly repository = new InMemoryReplayRepository()) {}

  start(config: ReplayConfig, sourceEvents: ReplaySourceEvent[]) {
    const sorted = sortReplayEvents(sourceEvents);
    const state: ReplayState = { replayId: config.replayId, clock: config.start, cursor: 0, deliveredEventIds: [], seed: config.seed, status: "running", config };
    this.repository.save(state);
    const event = createDomainEvent({ eventType: ReplayV2EventTypes.ReplayStarted, sourceModule: "replay", payload: { replayId: config.replayId, sourceHash: hash(sorted) }, occurredAt: new Date(config.start) });
    return { state, events: [event], sourceEvents: sorted };
  }

  step(replayId: string, sourceEvents: ReplaySourceEvent[]) {
    const state = this.requireRunning(replayId);
    const sorted = sortReplayEvents(sourceEvents);
    const next = sorted[state.cursor];
    if (!next) return this.complete(state);
    const clock = new ReplayClock(Date.parse(state.clock));
    clock.advanceTo(next.publishedAt);
    if (clock.now() > state.config.end) return this.complete(state);
    if (!visibleAt(next, clock.now())) {
      return { state, delivered: [], events: [createDomainEvent({ eventType: ReplayV2EventTypes.ReplayFutureDataBlocked, sourceModule: "replay", payload: { replayId, eventId: next.eventId } })] };
    }
    if (state.deliveredEventIds.includes(next.eventId)) throw new Error("Replay resume would duplicate an event");
    const advanced: ReplayState = { ...state, clock: clock.now(), cursor: state.cursor + 1, deliveredEventIds: [...state.deliveredEventIds, next.eventId] };
    this.repository.save(advanced);
    return { state: advanced, delivered: [next], events: [createDomainEvent({ eventType: ReplayV2EventTypes.ReplayAdvanced, sourceModule: "replay", payload: { replayId, eventId: next.eventId, clock: advanced.clock } })] };
  }

  checkpoint(replayId: string) {
    const state = this.repository.get(replayId);
    if (!state) throw new Error("Replay not found");
    const checkpoint = this.repository.checkpoint(state);
    return { checkpoint, events: [createDomainEvent({ eventType: ReplayV2EventTypes.ReplayCheckpointCreated, sourceModule: "replay", payload: { replayId, cursor: checkpoint.cursor } })] };
  }

  resume(checkpoint: ReplayState) {
    this.repository.save({ ...checkpoint, status: "running" });
    return createDomainEvent({ eventType: ReplayV2EventTypes.ReplayResumed, sourceModule: "replay", payload: { replayId: checkpoint.replayId, cursor: checkpoint.cursor } });
  }

  pause(replayId: string) { const state = this.require(replayId); state.status = "paused"; this.repository.save(state); return createDomainEvent({ eventType: ReplayV2EventTypes.ReplayPaused, sourceModule: "replay", payload: { replayId } }); }
  cancel(replayId: string) { const state = this.require(replayId); state.status = "cancelled"; this.repository.save(state); return createDomainEvent({ eventType: ReplayV2EventTypes.ReplayCancelled, sourceModule: "replay", payload: { replayId } }); }
  get(replayId: string) { return this.repository.get(replayId); }

  private complete(state: ReplayState) {
    const completed = { ...state, status: "completed" as const };
    this.repository.save(completed);
    return { state: completed, delivered: [], events: [createDomainEvent({ eventType: ReplayV2EventTypes.ReplayCompleted, sourceModule: "replay", payload: { replayId: state.replayId, delivered: state.deliveredEventIds.length } })] };
  }
  private requireRunning(replayId: string) { const state = this.require(replayId); if (state.status !== "running") throw new Error("Replay is not running"); return state; }
  private require(replayId: string) { const state = this.repository.get(replayId); if (!state) throw new Error("Replay not found"); return state; }
}
function hash(events: ReplaySourceEvent[]) { return createHash("sha256").update(JSON.stringify(events)).digest("hex"); }
export const replayV2Service = new ReplayV2Service();
