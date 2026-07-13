import type { ReplayCheckpoint, ReplayState } from "./contracts";

export class InMemoryReplayRepository {
  private states = new Map<string, ReplayState>();
  save(state: ReplayState) { this.states.set(state.replayId, cloneState(state)); }
  get(replayId: string) { const found = this.states.get(replayId); return found ? cloneState(found) : null; }
  checkpoint(state: ReplayState): ReplayCheckpoint { const checkpoint = { replayId: state.replayId, clock: state.clock, cursor: state.cursor, deliveredEventIds: [...state.deliveredEventIds], seed: state.seed }; this.save(state); return checkpoint; }
}
function cloneState(state: ReplayState): ReplayState { return { ...state, config: { ...state.config, instruments: [...state.config.instruments], timeframes: [...state.config.timeframes] }, deliveredEventIds: [...state.deliveredEventIds] }; }
