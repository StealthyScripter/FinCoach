export const ReplayV2EventTypes = {
  ReplayStarted: "ReplayStarted",
  ReplayAdvanced: "ReplayAdvanced",
  ReplayPaused: "ReplayPaused",
  ReplayCheckpointCreated: "ReplayCheckpointCreated",
  ReplayResumed: "ReplayResumed",
  ReplayCompleted: "ReplayCompleted",
  ReplayFailed: "ReplayFailed",
  ReplayCancelled: "ReplayCancelled",
  ReplayFutureDataBlocked: "ReplayFutureDataBlocked",
} as const;
