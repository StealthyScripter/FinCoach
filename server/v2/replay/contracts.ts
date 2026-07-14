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
  sourceCursor?: unknown;
};
export type ReplayState = ReplayCheckpoint & {
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  config: ReplayConfig;
};

export type ReplaySourceCursor = {
  schemaVersion: string;
  sourceId: string;
  position: number;
  lastEventId: string | null;
  lastOrderingKey: string | null;
  datasetManifestHash?: string;
};

export type ReplaySourceBatch = {
  events: ReplaySourceEvent[];
  cursor: ReplaySourceCursor | null;
  end: boolean;
  readCount: number;
};

export type ReplaySourceHealth = {
  state: "available" | "degraded" | "unavailable";
  recordCount?: number;
  partitionCount?: number;
  failureClass?: string;
};

export interface ReplaySource {
  readonly sourceId: string;
  readonly schemaVersion: string;
  readNext(cursor: ReplaySourceCursor | null, limit: number, signal?: AbortSignal): Promise<ReplaySourceBatch>;
  health(): Promise<ReplaySourceHealth>;
}
