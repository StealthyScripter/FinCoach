export type ReplayMode = "step" | "candle" | "event" | "session" | "accelerated";
export type ReplaySourceEvent = {
  eventId: string;
  sourceId: string;
  priority: number;
  effectiveAt: string;
  publishedAt: string;
  type: string;
  payload: Record<string, unknown>;
};
export type ReplayConfig = {
  replayId: string;
  start: string;
  end: string;
  mode: ReplayMode;
  seed: number;
  instruments: string[];
  timeframes: string[];
};
export type ReplayCheckpoint = {
  replayId: string;
  clock: string;
  cursor: number;
  deliveredEventIds: string[];
  seed: number;
};
export type ReplayState = ReplayCheckpoint & {
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  config: ReplayConfig;
};
