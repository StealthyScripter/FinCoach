export type DemoResearchPilotState = "not_started" | "starting" | "running" | "degraded" | "paused" | "stopping" | "stopped" | "failed" | "completed";

export type DemoResearchPilotConfig = {
  pilotId: string;
  enabledInstruments: readonly string[];
  enabledTimeframes: readonly string[];
  researchBudget: number;
  concurrencyBudget: number;
  experimentBudget: number;
  allowedDemoProviders: readonly string[];
  signalPublicationPolicy: "disabled" | "research_only";
  externalEvaluationPolicy: "disabled" | "fixture_only" | "demo_only";
  forwardTestingPolicy: "disabled" | "demo_only";
  pilotStartTime: string;
  retentionDays: number;
  healthThresholds: { maxDeadLetters: number };
  safeStopConditions: readonly string[];
  externalPracticeTradesEnabled: false;
};

export type DemoResearchPilotStartupGates = {
  v2Enabled: boolean;
  researchEnabled: boolean;
  liveExecutionBlocked: boolean;
  killSwitchHealthy: boolean;
  postgresqlStateKnown: boolean;
  repositoriesHealthy: boolean;
  orchestrationHealthy: boolean;
  unresolvedCriticalDeadLetters: number;
  brokerMode: "none" | "practice" | "unknown" | "live";
  seededPromotedStrategies: number;
  featureSchemaCompatible: boolean;
  migrationStateValid: boolean;
  providersHealthyOrExplicitlyDegraded: boolean;
};

export type DemoResearchPilotScorecard = {
  observationsGenerated: number;
  hypothesesCreated: number;
  hypothesesRejected: number;
  experimentsQueued: number;
  experimentsCompleted: number;
  backtestsCompleted: number;
  candidatesRejectedForOverfitting: number;
  candidatesRejectedForLeakage: number;
  courtroomVerdicts: number;
  rankedCandidates: number;
  lifecycleTransitions: number;
  forwardTests: number;
  signalsPublished: number;
  externalEvaluations: number;
  evaluatorDisagreements: number;
  netR: number;
  winRate: number;
  expectancy: number;
  drawdown: number;
  costSensitivity: number;
  calibration: number;
  edgeDecay: number;
  lessonsCreated: number;
  strategyRevisionsProposed: number;
  strategiesPaused: number;
  strategiesDegraded: number;
  strategiesRetired: number;
  operationalFailures: number;
  deadLetterEvents: number;
  researchThroughput: number;
  estimatedCostPerValidatedStrategy: number;
};

export type DemoResearchPilotRecord = {
  pilotId: string;
  schemaVersion: "fincoach.v2.demo-research-pilot.1";
  state: DemoResearchPilotState;
  config: DemoResearchPilotConfig;
  scorecard: DemoResearchPilotScorecard;
  lineageEventIds: readonly string[];
  startedAt: string | null;
  stoppedAt: string | null;
  updatedAt: string;
};

export type DemoResearchPilotReport = {
  reportId: string;
  schemaVersion: "fincoach.v2.demo-research-pilot-report.1";
  pilotId: string;
  state: DemoResearchPilotState;
  config: DemoResearchPilotConfig;
  scorecard: DemoResearchPilotScorecard;
  durationMinutes: number;
  safetyState: {
    liveExecutionBlocked: true;
    externalPracticeTradesEnabled: false;
    historicalReplayNotForwardTesting: true;
  };
  lineageEventIds: readonly string[];
  knownLimitations: readonly string[];
  createdAt: string;
  liveExecutionBlocked: true;
};
