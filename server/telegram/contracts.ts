import { z } from "zod";

export const TELEGRAM_SIGNAL_SCHEMA = "fincoach.signal.v1" as const;

export type TelegramEnvironmentConfig = {
  botToken: string | null;
  allowedUserId: string | null;
  chatId: string | null;
  signalChatId: string | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
  notificationsEnabled: boolean;
  signalsEnabled: boolean;
  dailySummaryHourUtc: number;
  weeklySummaryDay: number;
  weeklySummaryHourUtc: number;
  marketSessionAlerts: boolean;
  minSignalConfidence: number;
  minSignalEvidenceScore: number;
  signalCooldownMinutes: number;
  signalSigningSecret: string | null;
};

export type TelegramConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  redacted: Record<string, unknown>;
};

export type TelegramDeliveryStatus = "queued" | "sent" | "failed" | "rate_limited" | "suppressed";
export type TelegramMessageKind =
  | "lifecycle"
  | "health"
  | "report"
  | "market_session"
  | "kill_switch"
  | "signal"
  | "signal_update"
  | "command"
  | "test";

export type TelegramDeliveryRecord = {
  id: string;
  kind: TelegramMessageKind;
  destination: "operations" | "signals";
  chatIdRedacted: string | null;
  status: TelegramDeliveryStatus;
  textHash: string;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryAfterSeconds: number | null;
  attemptCount: number;
  latencyMs: number | null;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TelegramClientHealth = {
  configured: boolean;
  enabled: boolean;
  lastSuccessfulSendAt: string | null;
  lastFailedSendAt: string | null;
  consecutiveFailureCount: number;
  rateLimitedUntil: string | null;
};

export type TelegramSendRequest = {
  kind: TelegramMessageKind;
  destination: "operations" | "signals";
  chatId: string;
  text: string;
  parseMode?: "MarkdownV2" | "Markdown" | "HTML";
  disableWebPagePreview?: boolean;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export type TelegramSendResult = {
  ok: boolean;
  delivery: TelegramDeliveryRecord;
  telegramMessageId: string | null;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type TelegramAuditEvent =
  | "TelegramMessageQueued"
  | "TelegramMessageSent"
  | "TelegramMessageFailed"
  | "TelegramRateLimited"
  | "ApplicationStarted"
  | "ApplicationStopping"
  | "ApplicationRecovered"
  | "ApplicationHeartbeatRecorded"
  | "MarketSessionOpened"
  | "MarketSessionClosed"
  | "MarketSessionAlertSent"
  | "TelegramSignalRejected"
  | "TelegramSignalPublished"
  | "TelegramSignalLifecycleUpdated"
  | "TelegramCommandAudited";

export type TelegramNormalizedUpdate = {
  source: "telegram";
  updateId: number;
  chatId: string;
  actorId: string;
  messageId: string;
  text: string;
  receivedAt: string;
};

export type TelegramNormalizedCommand = {
  source: "telegram";
  command: string;
  args: string[];
  actorId: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
};

export const finCoachSignalSchema = z.object({
  schema: z.literal(TELEGRAM_SIGNAL_SCHEMA),
  signalId: z.string().uuid(),
  environment: z.literal("demo_research"),
  symbol: z.string().min(1),
  displaySymbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  entryType: z.enum(["market", "limit", "stop"]),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  riskReward: z.number().positive(),
  timeframe: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersion: z.number().int().positive(),
  experimentId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceScore: z.number().min(0).max(1),
  generatedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  demoOnly: z.literal(true),
  sequence: z.number().int().positive().optional(),
  fingerprint: z.string().optional(),
  idempotencyKey: z.string().optional(),
  signatureAlgorithm: z.literal("HMAC-SHA256").optional(),
  signature: z.string().optional(),
});

export type FinCoachSignal = z.infer<typeof finCoachSignalSchema>;

export type SignalQualityGateInput = {
  signal: Omit<FinCoachSignal, "schema" | "environment" | "demoOnly" | "fingerprint" | "idempotencyKey" | "signatureAlgorithm" | "signature"> & {
    reason: string;
    invalidation: string;
  };
  demoRunRunning: boolean;
  demoOnlyPolicyHealthy: boolean;
  killSwitchInactive: boolean;
  marketDataFresh: boolean;
  providerHealthAcceptable: boolean;
  objectiveRuleSetExists: boolean;
  experimentExists: boolean;
  backtestEvidenceExists: boolean;
  validationVerdictPermitsObservation: boolean;
  stabilityThresholdPasses: boolean;
  minimumSampleSizePasses: boolean;
  rewardRiskAcceptable: boolean;
  eventLineageComplete: boolean;
  marketSessionAllowsEntry: boolean;
  majorNewsBlackoutClear: boolean;
  marketDataAgeSeconds?: number | null;
  sampleSize?: number | null;
  sourceEventRefs?: string[];
};

export type SignalGateResult = {
  accepted: boolean;
  rejectionReasons: string[];
  fingerprint: string;
  idempotencyKey: string;
};

export type TelegramSignalRecord = {
  signalId: string;
  schema: typeof TELEGRAM_SIGNAL_SCHEMA;
  fingerprint: string;
  idempotencyKey: string;
  status: "published" | "rejected" | "expired" | "cancelled" | "triggered" | "take_profit" | "stop_loss" | "manual_close" | "invalidated" | "evaluated";
  symbol: string;
  payload: FinCoachSignal;
  humanMessage: string;
  rejectionReasons: string[];
  publishedAt: string | null;
  expiresAt: string;
  lastUpdateAt: string;
  metadata: Record<string, unknown>;
};

export type TelegramSignalLifecycleUpdate = {
  id: string;
  signalId: string;
  outcome: TelegramSignalRecord["status"];
  message: string;
  resultR: number | null;
  demoPnl: number | null;
  lesson: string | null;
  createdAt: string;
};

export type TelegramSummaryRecord = {
  id: string;
  period: "daily" | "weekly";
  summaryDate: string;
  conciseMessage: string;
  report: Record<string, unknown>;
  deliveryId: string | null;
  createdAt: string;
};

export type TelegramSchedulerRunRecord = {
  id: string;
  jobName: string;
  status: "started" | "completed" | "skipped" | "failed";
  leaseKey: string | null;
  details: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
};

export type TelegramCommandAuditRecord = {
  id: string;
  command: string;
  actorIdRedacted: string;
  chatIdRedacted: string;
  authorized: boolean;
  outcome: "accepted" | "rejected" | "confirmation_required" | "blocked";
  reason: string | null;
  createdAt: string;
};

export type TelegramMetricsSnapshot = {
  sendsAttempted: number;
  sendsSucceeded: number;
  sendsFailed: number;
  rateLimits: number;
  commandsReceived: number;
  unauthorizedCommands: number;
  summariesGenerated: number;
  summaryGenerationAttempts: number;
  summariesCreated: number;
  existingSummariesReused: number;
  automaticSummarySends: number;
  manualSummarySends: number;
  duplicateSummarySendsSuppressed: number;
  schedulerJobsCompleted: number;
  schedulerJobsFailed: number;
  schedulerJobsSkipped: number;
  schedulerPersistenceFailures: number;
  lastDailySummaryStatus: string | null;
  lastWeeklySummaryStatus: string | null;
  lastSchedulerError: string | null;
  lastSuccessfulAutomaticDailySend: string | null;
  lastSuccessfulAutomaticWeeklySend: string | null;
  signalsConsidered: number;
  signalsRejected: number;
  signalsPublished: number;
  duplicatesSuppressed: number;
  staleSignalsSuppressed: number;
  killSwitchSuppressions: number;
  updatesReceived: number;
  updatesProcessed: number;
  updatesIgnored: number;
  updatesFailed: number;
  repliesSent: number;
  replyFailures: number;
  pollingReconnects: number;
  signalResultsByOutcome: Record<string, number>;
  averageSignalR: number | null;
  averageDeliveryLatencyMs: number | null;
};
