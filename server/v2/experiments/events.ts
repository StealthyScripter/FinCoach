export const ExperimentsV2EventTypes = {
  ExperimentCreated: "ExperimentCreated", ExperimentQueued: "ExperimentQueued", ExperimentLeased: "ExperimentLeased", ExperimentStarted: "ExperimentStarted",
  ExperimentCheckpointed: "ExperimentCheckpointed", ExperimentCompleted: "ExperimentCompleted", ExperimentFailed: "ExperimentFailed", ExperimentRetried: "ExperimentRetried",
  ExperimentCancelled: "ExperimentCancelled", ExperimentLeaseExpired: "ExperimentLeaseExpired", ExperimentDuplicateSuppressed: "ExperimentDuplicateSuppressed", ExperimentBudgetExceeded: "ExperimentBudgetExceeded",
} as const;
