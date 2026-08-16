import { DEFAULT_RESEARCH_SYMBOLS, parseResearchSymbols, validateResearchUniverse } from "../researchUniverse";

export type FinCoachTelegramTransport = "long_polling" | "webhook" | "disabled";

export type V2RuntimeConfig = {
  runtimeEnabled: boolean;
  autostart: boolean;
  pilotEnabled: boolean;
  researchEnabled: boolean;
  forwardTestingEnabled: boolean;
  researchSignalEnabled: boolean;
  telegramSignalPublicationEnabled: boolean;
  paperExecutionEnabled: boolean;
  demoBrokerExecutionEnabled: boolean;
  liveExecutionEnabled: boolean;
  telegramTransport: FinCoachTelegramTransport;
  pilotId: string;
  symbols: string[];
  timeframes: string[];
  cadenceMs: number;
  maxCyclesPerDay: number;
  maxObservationsPerCycle: number;
  maxHypothesesPerCycle: number;
  maxExperimentsPerCycle: number;
  maxBacktestsPerCycle: number;
  maxActiveForwardTests: number;
  maxActiveResearchSignals: number;
  minIndependentHypothesisOccurrences: number;
  hypothesisLookbackHours: number;
  targetEvaluationsPerHour: number;
  minEvaluationsPerHour: number;
  maxTemplatesPerSymbolSession: number;
  maxVariantsPerTemplate: number;
  maxCandidatesPerFamilyPerCycle: number;
  maxCandidatesPerSymbolPerCycle: number;
  observationMaxConcurrency: number;
  observationBatchSize: number;
  providerRequestsPerMinute: number;
  minBacktestTrades: number;
  minBacktestDays: number;
  minForwardTestTrades: number;
  minForwardTestDays: number;
  minProfitFactor: number;
  maxDrawdownPct: number;
  minSharpeRatio: number;
  requireHumanLiveApproval: boolean;
  maxPaperPositions: number;
  maxPaperRiskPerPosition: number;
  maxPaperDailyLoss: number;
  providerCallBudget: number;
  databaseWriteBudget: number;
  retryBudget: number;
  cycleTimeoutMs: number;
  memoryRetentionLimit: number;
  leaseTtlMs: number;
  leaseRenewIntervalMs: number;
  weeklyResearchSchedule: WeeklyResearchScheduleConfig;
  continuousMarketWeeklyPause: ContinuousMarketWeeklyPauseConfig;
  marketSnapshot: MarketSnapshotConfig;
  researchDataMode: "provider" | "synthetic";
  weekendDormancy: WeekendDormancyConfig;
};

export type V2RuntimeConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  config: V2RuntimeConfig;
  provenance: Record<string, { present: boolean; parsed: unknown; raw: string | null; source: string }>;
};

export type WeeklyResearchScheduleConfig = {
  enabled: boolean;
  timezone: string;
  openDay: number;
  openTime: string;
  closeDay: number;
  closeTime: string;
  startLeadMinutes: number;
};

export type ContinuousMarketWeeklyPauseConfig = {
  enabled: boolean;
  timezone: string;
  pauseDay: number;
  pauseTime: string;
  resumeDay: number;
  resumeTime: string;
};

export type MarketSnapshotConfig = {
  enabled: boolean;
  timezone: string;
  morningTime: string;
  eveningTime: string;
  includeWeekends: boolean;
  maxEvents: number;
  lookaheadHours: number;
};

export type WeekendDormancyConfig = {
  enabled: boolean;
  postCloseObservationHours: number;
  preOpenWakeMinutes: number;
};

const DEFAULT_SYMBOLS = DEFAULT_RESEARCH_SYMBOLS;
const DEFAULT_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "3h", "6h", "1d", "1w"];

export function loadV2RuntimeConfig(env: NodeJS.ProcessEnv = process.env): V2RuntimeConfigValidation {
  const config: V2RuntimeConfig = {
    runtimeEnabled: bool(env.FINCOACH_V2_RUNTIME_ENABLED, false),
    autostart: bool(env.FINCOACH_V2_AUTOSTART, false),
    pilotEnabled: bool(env.FINCOACH_V2_PILOT_ENABLED, false),
    researchEnabled: bool(env.FINCOACH_V2_RESEARCH_ENABLED, false),
    forwardTestingEnabled: bool(env.FINCOACH_V2_FORWARD_TESTING_ENABLED, false),
    researchSignalEnabled: bool(env.FINCOACH_V2_RESEARCH_SIGNAL_ENABLED, false),
    telegramSignalPublicationEnabled: bool(env.FINCOACH_V2_TELEGRAM_SIGNAL_PUBLICATION_ENABLED, false),
    paperExecutionEnabled: bool(env.FINCOACH_PAPER_EXECUTION_ENABLED, false),
    demoBrokerExecutionEnabled: bool(env.FINCOACH_DEMO_BROKER_EXECUTION_ENABLED, false),
    liveExecutionEnabled: bool(env.FINCOACH_LIVE_EXECUTION_ENABLED, false),
    telegramTransport: transport(env.FINCOACH_TELEGRAM_TRANSPORT),
    pilotId: clean(env.FINCOACH_V2_PILOT_ID) ?? "v2-bounded-paper-research",
    symbols: parseResearchSymbols(env.FINCOACH_V2_OBSERVATION_SYMBOLS ?? env.FINCOACH_V2_SYMBOLS, DEFAULT_SYMBOLS),
    timeframes: list(env.FINCOACH_V2_OBSERVATION_TIMEFRAMES ?? env.FINCOACH_V2_TIMEFRAMES, DEFAULT_TIMEFRAMES).map(normalizeTimeframeAlias),
    cadenceMs: Math.max(60_000, int(env.FINCOACH_V2_CADENCE_MS, 60 * 60 * 1000)),
    maxCyclesPerDay: int(env.FINCOACH_V2_MAX_CYCLES_PER_DAY, 8),
    maxObservationsPerCycle: int(env.FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE, 10),
    maxHypothesesPerCycle: int(env.FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE, 5),
    maxExperimentsPerCycle: int(env.FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE, 3),
    maxBacktestsPerCycle: int(env.FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE, 3),
    maxActiveForwardTests: int(env.FINCOACH_V2_MAX_ACTIVE_FORWARD_TESTS, 3),
    maxActiveResearchSignals: int(env.FINCOACH_V2_MAX_ACTIVE_RESEARCH_SIGNALS, 3),
    minIndependentHypothesisOccurrences: Math.max(2, int(env.FINCOACH_V2_MIN_INDEPENDENT_HYPOTHESIS_OCCURRENCES, 2)),
    hypothesisLookbackHours: Math.max(1, int(env.FINCOACH_V2_HYPOTHESIS_LOOKBACK_HOURS, 720)),
    targetEvaluationsPerHour: int(env.FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR, 200),
    minEvaluationsPerHour: int(env.FINCOACH_V2_MIN_EVALUATIONS_PER_HOUR, 100),
    maxTemplatesPerSymbolSession: Math.max(1, int(env.FINCOACH_V2_MAX_TEMPLATES_PER_SYMBOL_SESSION, 3)),
    maxVariantsPerTemplate: Math.max(1, int(env.FINCOACH_V2_MAX_VARIANTS_PER_TEMPLATE, 1)),
    maxCandidatesPerFamilyPerCycle: Math.max(1, int(env.FINCOACH_V2_MAX_CANDIDATES_PER_FAMILY_PER_CYCLE, 4)),
    maxCandidatesPerSymbolPerCycle: Math.max(1, int(env.FINCOACH_V2_MAX_CANDIDATES_PER_SYMBOL_PER_CYCLE, 4)),
    observationMaxConcurrency: Math.max(1, int(env.FINCOACH_V2_OBSERVATION_MAX_CONCURRENCY, 4)),
    observationBatchSize: Math.max(1, int(env.FINCOACH_V2_OBSERVATION_BATCH_SIZE, 25)),
    providerRequestsPerMinute: Math.max(1, int(env.FINCOACH_V2_PROVIDER_REQUESTS_PER_MINUTE, 60)),
    minBacktestTrades: int(env.FINCOACH_V2_MIN_BACKTEST_TRADES, 100),
    minBacktestDays: int(env.FINCOACH_V2_MIN_BACKTEST_DAYS, 90),
    minForwardTestTrades: int(env.FINCOACH_V2_MIN_FORWARD_TEST_TRADES, 30),
    minForwardTestDays: int(env.FINCOACH_V2_MIN_FORWARD_TEST_DAYS, 14),
    minProfitFactor: num(env.FINCOACH_V2_MIN_PROFIT_FACTOR, 1.2),
    maxDrawdownPct: num(env.FINCOACH_V2_MAX_DRAWDOWN_PCT, 10),
    minSharpeRatio: num(env.FINCOACH_V2_MIN_SHARPE_RATIO, 0.5),
    requireHumanLiveApproval: bool(env.FINCOACH_V2_REQUIRE_HUMAN_LIVE_APPROVAL, true),
    maxPaperPositions: int(env.FINCOACH_V2_MAX_PAPER_POSITIONS, 0),
    maxPaperRiskPerPosition: num(env.FINCOACH_V2_MAX_PAPER_RISK_PER_POSITION, 0),
    maxPaperDailyLoss: num(env.FINCOACH_V2_MAX_PAPER_DAILY_LOSS, 0),
    providerCallBudget: int(env.FINCOACH_V2_PROVIDER_CALL_BUDGET, 50),
    databaseWriteBudget: int(env.FINCOACH_V2_DATABASE_WRITE_BUDGET, 200),
    retryBudget: int(env.FINCOACH_V2_RETRY_BUDGET, 3),
    cycleTimeoutMs: int(env.FINCOACH_V2_CYCLE_TIMEOUT_MS, 120_000),
    memoryRetentionLimit: int(env.FINCOACH_V2_MEMORY_RETENTION_LIMIT, 1000),
    leaseTtlMs: int(env.FINCOACH_V2_LEASE_TTL_MS, 60_000),
    leaseRenewIntervalMs: int(env.FINCOACH_V2_LEASE_RENEW_INTERVAL_MS, 20_000),
    weeklyResearchSchedule: {
      enabled: bool(env.FINCOACH_WEEKLY_RESEARCH_SCHEDULE_ENABLED, true),
      timezone: clean(env.FINCOACH_WEEKLY_RESEARCH_TIMEZONE) ?? "America/New_York",
      openDay: int(env.FINCOACH_WEEKLY_RESEARCH_OPEN_DAY, 0),
      openTime: clean(env.FINCOACH_WEEKLY_RESEARCH_OPEN_TIME) ?? "17:00",
      closeDay: int(env.FINCOACH_WEEKLY_RESEARCH_CLOSE_DAY, 5),
      closeTime: clean(env.FINCOACH_WEEKLY_RESEARCH_CLOSE_TIME) ?? "18:00",
      startLeadMinutes: int(env.FINCOACH_WEEKLY_RESEARCH_START_LEAD_MINUTES, 5),
    },
    continuousMarketWeeklyPause: {
      enabled: bool(env.FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_ENABLED, true),
      timezone: "America/New_York",
      pauseDay: int(env.FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_DAY, 5),
      pauseTime: clean(env.FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_TIME) ?? "18:00",
      resumeDay: int(env.FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_DAY, 0),
      resumeTime: clean(env.FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_TIME) ?? "17:00",
    },
    marketSnapshot: {
      enabled: bool(env.FINCOACH_MARKET_SNAPSHOT_ENABLED, true),
      timezone: clean(env.FINCOACH_MARKET_SNAPSHOT_TIMEZONE) ?? "America/New_York",
      morningTime: clean(env.FINCOACH_MARKET_SNAPSHOT_MORNING_TIME) ?? "08:00",
      eveningTime: clean(env.FINCOACH_MARKET_SNAPSHOT_EVENING_TIME) ?? "20:00",
      includeWeekends: bool(env.FINCOACH_MARKET_SNAPSHOT_INCLUDE_WEEKENDS, true),
      maxEvents: Math.min(50, int(env.FINCOACH_MARKET_SNAPSHOT_MAX_EVENTS, 12)),
      lookaheadHours: Math.min(168, int(env.FINCOACH_MARKET_SNAPSHOT_LOOKAHEAD_HOURS, 24)),
    },
    researchDataMode: env.FINCOACH_V2_RESEARCH_DATA_MODE?.trim().toLowerCase() === "provider" || env.NODE_ENV === "production" ? "provider" : "synthetic",
    weekendDormancy: {
      enabled: bool(env.FINCOACH_WEEKEND_DORMANCY_ENABLED, true),
      postCloseObservationHours: Math.max(0, num(env.FINCOACH_POST_CLOSE_OBSERVATION_HOURS, 2)),
      preOpenWakeMinutes: Math.max(0, int(env.FINCOACH_PRE_OPEN_WAKE_MINUTES, 30)),
    },
  };

  const errors: string[] = [];
  const warnings: string[] = [];
  if (config.liveExecutionEnabled) errors.push("FINCOACH_LIVE_EXECUTION_ENABLED must remain false.");
  if (config.telegramSignalPublicationEnabled && !config.researchSignalEnabled) errors.push("Telegram signal publication requires research signal creation.");
  if (config.demoBrokerExecutionEnabled && config.liveExecutionEnabled) errors.push("Demo broker execution cannot run with live execution enabled.");
  if (config.paperExecutionEnabled && config.maxPaperPositions <= 0) errors.push("Paper execution requires FINCOACH_V2_MAX_PAPER_POSITIONS > 0.");
  if (config.runtimeEnabled && !process.env.DATABASE_URL) errors.push("DATABASE_URL is required when FINCOACH_V2_RUNTIME_ENABLED=true.");
  if (config.researchEnabled && !config.runtimeEnabled) errors.push("Research cannot be enabled when V2 runtime is disabled.");
  if (config.pilotEnabled && !config.researchEnabled) errors.push("Pilot cannot be enabled when V2 research is disabled.");
  if (config.autostart && (!config.runtimeEnabled || !config.pilotEnabled || !config.researchEnabled)) errors.push("Autostart requires runtime, pilot, and research enabled.");
  if (config.researchDataMode === "synthetic" && env.NODE_ENV === "production") errors.push("Synthetic V2 research data is prohibited in production.");
  if (config.researchEnabled && config.researchDataMode === "provider") {
    if ((env.OANDA_ENV?.trim().toLowerCase() || "practice") !== "practice") errors.push("V2 provider research requires OANDA_ENV=practice.");
    if (!env.OANDA_API_TOKEN?.trim()) errors.push("V2 provider research requires OANDA_API_TOKEN.");
    if (!env.OANDA_ACCOUNT_ID?.trim()) errors.push("V2 provider research requires OANDA_ACCOUNT_ID.");
  }
  if (config.symbols.length === 0) errors.push("At least one V2 symbol is required.");
  const universe = validateResearchUniverse(config.symbols);
  if (config.researchEnabled && universe.unsupported.length) {
    errors.push(`Unsupported V2 research symbols: ${universe.unsupported.map(item => item.symbol).join(", ")}.`);
  }
  if (config.timeframes.length === 0) errors.push("At least one V2 timeframe is required.");
  if (config.targetEvaluationsPerHour < config.minEvaluationsPerHour) warnings.push("V2 target evaluations per hour is below the minimum target.");
  if (config.cadenceMs < 60_000) errors.push("V2 cadence must be at least 60000ms.");
  if (config.maxCyclesPerDay < 0) errors.push("FINCOACH_V2_MAX_CYCLES_PER_DAY must be >= 0.");
  if (config.cycleTimeoutMs <= 0) errors.push("FINCOACH_V2_CYCLE_TIMEOUT_MS must be > 0.");
  if (config.leaseTtlMs <= 0) errors.push("FINCOACH_V2_LEASE_TTL_MS must be > 0.");
  if (config.leaseRenewIntervalMs <= 0) errors.push("FINCOACH_V2_LEASE_RENEW_INTERVAL_MS must be > 0.");
  if (config.leaseRenewIntervalMs >= config.leaseTtlMs) errors.push("FINCOACH_V2_LEASE_RENEW_INTERVAL_MS must be less than FINCOACH_V2_LEASE_TTL_MS.");
  if (config.telegramTransport === "webhook" && env.TELEGRAM_LONG_POLLING_ENABLED === "true") errors.push("Webhook and long polling cannot both be active.");
  if (config.telegramTransport === "long_polling" && env.TELEGRAM_WEBHOOK_ENABLED === "true") errors.push("Long polling and webhook cannot both be active.");
  if (config.weekendDormancy.enabled && config.weekendDormancy.postCloseObservationHours > 48) errors.push("FINCOACH_POST_CLOSE_OBSERVATION_HOURS must be <= 48.");
  if (config.weekendDormancy.enabled && config.weekendDormancy.preOpenWakeMinutes > 24 * 60) errors.push("FINCOACH_PRE_OPEN_WAKE_MINUTES must be <= 1440.");
  if (config.weeklyResearchSchedule.enabled) {
    const weeklyErrors = validateWeeklyResearchSchedule(config.weeklyResearchSchedule);
    errors.push(...weeklyErrors);
  }
  if (config.continuousMarketWeeklyPause.enabled) {
    if (!validDay(config.continuousMarketWeeklyPause.pauseDay)) errors.push("FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_DAY must be an integer from 0 to 6.");
    if (!validDay(config.continuousMarketWeeklyPause.resumeDay)) errors.push("FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_DAY must be an integer from 0 to 6.");
    if (!validTime(config.continuousMarketWeeklyPause.pauseTime)) errors.push("FINCOACH_CONTINUOUS_MARKET_WEEKLY_PAUSE_TIME must use HH:mm.");
    if (!validTime(config.continuousMarketWeeklyPause.resumeTime)) errors.push("FINCOACH_CONTINUOUS_MARKET_WEEKLY_RESUME_TIME must use HH:mm.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.marketSnapshot.timezone }).format(new Date());
  } catch {
    errors.push("FINCOACH_MARKET_SNAPSHOT_TIMEZONE must be a valid IANA timezone.");
  }
  if (!validTime(config.marketSnapshot.morningTime)) errors.push("FINCOACH_MARKET_SNAPSHOT_MORNING_TIME must use HH:mm.");
  if (!validTime(config.marketSnapshot.eveningTime)) errors.push("FINCOACH_MARKET_SNAPSHOT_EVENING_TIME must use HH:mm.");
  if (!config.researchSignalEnabled) warnings.push("V2 research signal creation is disabled.");
  if (!config.telegramSignalPublicationEnabled) warnings.push("Telegram trading signal publication is disabled.");
  if (!config.paperExecutionEnabled) warnings.push("Internal paper execution is disabled.");
  if (!config.demoBrokerExecutionEnabled) warnings.push("Demo broker execution is disabled.");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    config,
    provenance: {
      FINCOACH_V2_AUTOSTART: provenance(env.FINCOACH_V2_AUTOSTART, config.autostart),
      FINCOACH_V2_RUNTIME_ENABLED: provenance(env.FINCOACH_V2_RUNTIME_ENABLED, config.runtimeEnabled),
      FINCOACH_V2_RESEARCH_ENABLED: provenance(env.FINCOACH_V2_RESEARCH_ENABLED, config.researchEnabled),
      FINCOACH_V2_PILOT_ENABLED: provenance(env.FINCOACH_V2_PILOT_ENABLED, config.pilotEnabled),
      FINCOACH_LIVE_EXECUTION_ENABLED: provenance(env.FINCOACH_LIVE_EXECUTION_ENABLED, config.liveExecutionEnabled),
    },
  };
}

function validateWeeklyResearchSchedule(config: WeeklyResearchScheduleConfig) {
  const errors: string[] = [];
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(new Date());
  } catch {
    errors.push("FINCOACH_WEEKLY_RESEARCH_TIMEZONE must be a valid IANA timezone.");
  }
  if (!Number.isInteger(config.openDay) || config.openDay < 0 || config.openDay > 6) errors.push("FINCOACH_WEEKLY_RESEARCH_OPEN_DAY must be an integer from 0 to 6.");
  if (!Number.isInteger(config.closeDay) || config.closeDay < 0 || config.closeDay > 6) errors.push("FINCOACH_WEEKLY_RESEARCH_CLOSE_DAY must be an integer from 0 to 6.");
  if (!validTime(config.openTime)) errors.push("FINCOACH_WEEKLY_RESEARCH_OPEN_TIME must use HH:mm.");
  if (!validTime(config.closeTime)) errors.push("FINCOACH_WEEKLY_RESEARCH_CLOSE_TIME must use HH:mm.");
  if (!Number.isInteger(config.startLeadMinutes) || config.startLeadMinutes < 0 || config.startLeadMinutes > 1440) errors.push("FINCOACH_WEEKLY_RESEARCH_START_LEAD_MINUTES must be an integer from 0 to 1440.");
  return errors;
}

function validTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match);
}

function validDay(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function bool(value: string | undefined, fallback: boolean) {
  const trimmed = clean(value);
  if (!trimmed) return fallback;
  if (/^(true|1|yes|on)$/i.test(trimmed)) return true;
  if (/^(false|0|no|off)$/i.test(trimmed)) return false;
  return fallback;
}

function provenance(value: string | undefined, parsed: unknown) {
  const trimmed = value?.trim();
  return {
    present: trimmed !== undefined && trimmed.length > 0,
    parsed,
    raw: trimmed ? redactEnvValue(trimmed) : null,
    source: "process.env after launch-shell preprocessing",
  };
}

function redactEnvValue(value: string) {
  if (/^(true|false|1|0|yes|no|on|off)$/i.test(value)) return value;
  return "[set]";
}

function int(value: string | undefined, fallback: number) {
  const cleaned = clean(value);
  if (cleaned === null) return fallback;
  const parsed = Number(cleaned);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function num(value: string | undefined, fallback: number) {
  const cleaned = clean(value);
  if (cleaned === null) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function list(value: string | undefined, fallback: string[]) {
  const parsed = clean(value)?.split(",").map(item => item.trim()).filter(Boolean) ?? fallback;
  return [...new Set(parsed)];
}

function normalizeTimeframeAlias(value: string) {
  const normalized = value.trim().toLowerCase();
  return ({
    m1: "1m",
    m5: "5m",
    m15: "15m",
    m30: "30m",
    h1: "1h",
    h3: "3h",
    h4: "4h",
    h6: "6h",
    d: "1d",
    w: "1w",
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "1hr": "1h",
    "3hr": "3h",
    "6hr": "6h",
    "1day": "1d",
    "1week": "1w",
  } as Record<string, string>)[normalized] ?? normalized;
}

function transport(value: string | undefined): FinCoachTelegramTransport {
  const parsed = clean(value);
  if (parsed === "long_polling" || parsed === "webhook" || parsed === "disabled") return parsed;
  return "disabled";
}
