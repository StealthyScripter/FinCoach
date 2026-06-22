export type DemoRunMode = "demo_observation";

export type DemoRunState = "idle" | "running" | "paused" | "stopped" | "completed";

export type DemoRunRiskLimits = {
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  confidenceThreshold: number;
};

export type DemoRunAdjustmentKind =
  | "pause_strategy"
  | "reduce_position_size"
  | "tighten_max_trades"
  | "increase_confidence_threshold"
  | "disable_strategy"
  | "mark_watch_candidate"
  | "mark_pause_candidate"
  | "mark_retire_candidate";

export type DemoRunAdjustment = {
  id: string;
  strategyId: string | null;
  kind: DemoRunAdjustmentKind;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  rollback: {
    possible: boolean;
    before: Record<string, unknown>;
  };
  createdAt: string;
  applied: boolean;
};

export type DemoRunDailyReport = {
  day: number;
  date: string;
  reliabilityScore: number;
  safetyScore: number;
  usabilityScore: number;
  calibrationScore: number;
  strategyPerformanceScore: number;
  riskScore: number;
  recommendedChanges: string[];
  topStrategies: string[];
  weakStrategies: string[];
  retirementCandidates: string[];
};

export type DemoRunStatus = {
  runId: string | null;
  mode: DemoRunMode;
  state: DemoRunState;
  startTime: string | null;
  endTime: string | null;
  pausedAt: string | null;
  uptimeSeconds: number;
  dayCount: number;
  connectedProviders: string[];
  allowedStrategies: string[];
  allowedSymbols: string[];
  riskLimits: DemoRunRiskLimits;
  modeConfigured: boolean;
  productionLiveExecutionBlocked: true;
  telemetryVersion: string;
  telemetrySummary: {
    reliabilityScore: number;
    safetyScore: number;
    usabilityScore: number;
    calibrationScore: number;
    strategyPerformanceScore: number;
    riskScore: number;
  };
  currentPnL: number;
  blockedActions: string[];
  topAdjustment: DemoRunAdjustment | null;
  latestDailyReport: DemoRunDailyReport | null;
};

export type DemoRunTelemetry = {
  generatedAt: string;
  runId: string | null;
  state: DemoRunState;
  uptimeSeconds: number;
  reliability: {
    uptimeSeconds: number;
    requestCount: number;
    errorCount: number;
    failedProviderCalls: number;
    staleDataEvents: number;
    reconnectEvents: number;
    webhookFailures: number;
    telegramCommandFailures: number;
    brokerSyncFailures: number;
  };
  safety: {
    killSwitchEvents: number;
    blockedOrders: number;
    rejectedSignals: number;
    riskPrecheckFailures: number;
    staleDataBlocks: number;
    dailyLossBlocks: number;
    confirmationFailures: number;
    unauthorizedTelegramAttempts: number;
  };
  usability: {
    telegramCommandsUsed: number;
    askMarketPilotPrompts: number;
    commandSuccessCount: number;
    commandFailureCount: number;
    repeatedUserActions: Array<{ action: string; count: number }>;
    abandonedConfirmationFlows: number;
    mostUsedScreens: Array<{ screen: string; count: number }>;
    alertOverloadCount: number;
  };
  calibration: {
    predictionConfidence: number;
    actualOutcome: number;
    confidenceDrift: number;
    falsePositives: number;
    falseNegatives: number;
    strategyWinLoss: { wins: number; losses: number };
    regretAnalysis: { regretScore: number; items: number };
    counterfactualResults: number;
    performanceDecay: number;
  };
  tradingPerformance: {
    tradesOpened: number;
    tradesClosed: number;
    pl: number;
    winRate: number;
    expectancy: number;
    maxDrawdown: number;
    sharpeEstimate: number;
    sortinoEstimate: number;
    riskReward: number;
    averageRMultiple: number;
    bestTrade: string | null;
    worstTrade: string | null;
    strategyPerformance: Array<{
      strategyId: string;
      strategyName: string;
      score: number;
      verdict: string;
    }>;
  };
  dailyReports: DemoRunDailyReport[];
  adjustments: DemoRunAdjustment[];
};

export type DemoRunFinalReport = {
  generatedAt: string;
  runId: string | null;
  mode: DemoRunMode;
  state: DemoRunState;
  dayCount: number;
  whatWorked: string[];
  whatFailed: string[];
  unsafePatterns: string[];
  bestStrategies: string[];
  weakStrategies: string[];
  missedOpportunities: string[];
  avoidedLosses: string[];
  confidenceCalibrationResults: string[];
  nextDeploymentRecommendation: string;
  dailyReports: DemoRunDailyReport[];
  adjustments: DemoRunAdjustment[];
  telemetrySummary: DemoRunStatus["telemetrySummary"];
};

export type DemoRunExportPayload = {
  generatedAt: string;
  status: DemoRunStatus;
  telemetry: DemoRunTelemetry;
  finalReport: DemoRunFinalReport | null;
};
