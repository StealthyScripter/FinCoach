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
  minIndependentHypothesisOccurrences: number;
  hypothesisLookbackHours: number;
  targetEvaluationsPerHour: number;
  minEvaluationsPerHour: number;
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
};

export type V2RuntimeConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  config: V2RuntimeConfig;
};

const DEFAULT_SYMBOLS = ["EUR_USD", "GBP_USD"];
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
    symbols: list(env.FINCOACH_V2_OBSERVATION_SYMBOLS ?? env.FINCOACH_V2_SYMBOLS, DEFAULT_SYMBOLS),
    timeframes: list(env.FINCOACH_V2_OBSERVATION_TIMEFRAMES ?? env.FINCOACH_V2_TIMEFRAMES, DEFAULT_TIMEFRAMES).map(normalizeTimeframeAlias),
    cadenceMs: Math.max(60_000, int(env.FINCOACH_V2_CADENCE_MS, 60 * 60 * 1000)),
    maxCyclesPerDay: int(env.FINCOACH_V2_MAX_CYCLES_PER_DAY, 8),
    maxObservationsPerCycle: int(env.FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE, 10),
    maxHypothesesPerCycle: int(env.FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE, 5),
    maxExperimentsPerCycle: int(env.FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE, 3),
    maxBacktestsPerCycle: int(env.FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE, 3),
    maxActiveForwardTests: int(env.FINCOACH_V2_MAX_ACTIVE_FORWARD_TESTS, 3),
    minIndependentHypothesisOccurrences: Math.max(2, int(env.FINCOACH_V2_MIN_INDEPENDENT_HYPOTHESIS_OCCURRENCES, 2)),
    hypothesisLookbackHours: Math.max(1, int(env.FINCOACH_V2_HYPOTHESIS_LOOKBACK_HOURS, 720)),
    targetEvaluationsPerHour: int(env.FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR, 200),
    minEvaluationsPerHour: int(env.FINCOACH_V2_MIN_EVALUATIONS_PER_HOUR, 100),
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
  if (config.symbols.length === 0) errors.push("At least one V2 symbol is required.");
  if (config.timeframes.length === 0) errors.push("At least one V2 timeframe is required.");
  if (config.targetEvaluationsPerHour < config.minEvaluationsPerHour) warnings.push("V2 target evaluations per hour is below the minimum target.");
  if (config.cadenceMs < 60_000) errors.push("V2 cadence must be at least 60000ms.");
  if (config.telegramTransport === "webhook" && env.TELEGRAM_LONG_POLLING_ENABLED === "true") errors.push("Webhook and long polling cannot both be active.");
  if (config.telegramTransport === "long_polling" && env.TELEGRAM_WEBHOOK_ENABLED === "true") errors.push("Long polling and webhook cannot both be active.");
  if (!config.researchSignalEnabled) warnings.push("V2 research signal creation is disabled.");
  if (!config.telegramSignalPublicationEnabled) warnings.push("Telegram trading signal publication is disabled.");
  if (!config.paperExecutionEnabled) warnings.push("Internal paper execution is disabled.");
  if (!config.demoBrokerExecutionEnabled) warnings.push("Demo broker execution is disabled.");

  return { ok: errors.length === 0, errors, warnings, config };
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

function int(value: string | undefined, fallback: number) {
  const parsed = Number(clean(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function num(value: string | undefined, fallback: number) {
  const parsed = Number(clean(value));
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
