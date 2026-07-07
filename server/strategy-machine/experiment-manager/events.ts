export const ExperimentManagerEventTypes = {
  ExperimentCreated: "ExperimentCreated",
  ExperimentStateChanged: "ExperimentStateChanged",
  ExperimentPromoted: "ExperimentPromoted",
  ExperimentDemoted: "ExperimentDemoted",
  ExperimentPaused: "ExperimentPaused",
  ExperimentRetired: "ExperimentRetired",
  ExperimentRefinementSuggested: "ExperimentRefinementSuggested",
  ExperimentVersionCreated: "ExperimentVersionCreated",
  RuleSetVersionCreated: "RuleSetVersionCreated",
  RetestRequested: "RetestRequested",
  LearningLoopCompleted: "LearningLoopCompleted",
} as const;
