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
const DEFAULT_TIMEFRAMES = ["M15"];

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
    symbols: list(env.FINCOACH_V2_SYMBOLS, DEFAULT_SYMBOLS),
    timeframes: list(env.FINCOACH_V2_TIMEFRAMES, DEFAULT_TIMEFRAMES),
    cadenceMs: int(env.FINCOACH_V2_CADENCE_MS, 60 * 60 * 1000),
    maxCyclesPerDay: int(env.FINCOACH_V2_MAX_CYCLES_PER_DAY, 8),
    maxObservationsPerCycle: int(env.FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE, 10),
    maxHypothesesPerCycle: int(env.FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE, 5),
    maxExperimentsPerCycle: int(env.FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE, 3),
    maxBacktestsPerCycle: int(env.FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE, 3),
    maxActiveForwardTests: int(env.FINCOACH_V2_MAX_ACTIVE_FORWARD_TESTS, 3),
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

function transport(value: string | undefined): FinCoachTelegramTransport {
  const parsed = clean(value);
  if (parsed === "long_polling" || parsed === "webhook" || parsed === "disabled") return parsed;
  return "disabled";
}
