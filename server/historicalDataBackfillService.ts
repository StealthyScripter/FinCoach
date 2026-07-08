import { historicalDataImportService, type HistoricalDataImportService } from "./historicalDataImportService";
import { normalizeInstrument, type Candle } from "./strategy-machine/market-data";
import { HistoricalCoveragePlanner, RESEARCH_INSTRUMENTS, RESEARCH_TIMEFRAMES } from "./researchAccelerationService";

const TARGET_YEARS = { minimum: 1, preferred: 3, ideal: 5 } as const;
const DEFAULT_MAX_CANDLES_PER_REQUEST = 5000;
const DEFAULT_MAX_REQUESTS_PER_RUN = 20;
const DEFAULT_RATE_LIMIT_MS = 250;

export type HistoricalDataAcquisitionPlan = {
  generatedAt: string;
  targets: typeof TARGET_YEARS;
  sourcePriority: string[];
  items: Array<{
    instrument: string;
    timeframe: Candle["timeframe"];
    candlesAvailable: number;
    yearsAvailable: number;
    target: string;
    missingWindows: Array<{ from: string; to: string; reason: string }>;
    estimatedCandlesToMinimum: number;
    estimatedCandlesToPreferred: number;
    estimatedCandlesToIdeal: number;
    nextSource: "oanda_practice" | "csv_or_archive" | "demo_fixture";
  }>;
};

export type OandaBackfillOptions = {
  instruments?: string[];
  timeframes?: Candle["timeframe"][];
  start?: string;
  end?: string;
  maxCandlesPerRequest?: number;
  maxRequestsPerRun?: number;
  dryRun?: boolean;
  resume?: boolean;
  rateLimitMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type BackfillProgress = {
  runId: string | null;
  running: boolean;
  stopRequested: boolean;
  dryRun: boolean;
  startedAt: string | null;
  completedAt: string | null;
  currentInstrument: string | null;
  currentTimeframe: Candle["timeframe"] | null;
  cursor: string | null;
  requestedWindows: number;
  requestsCompleted: number;
  candlesFetched: number;
  candlesImported: number;
  duplicatesSkipped: number;
  gapsDetected: number;
  latestImportedAt: string | null;
  estimatedCompletion: string | null;
  warnings: string[];
  coverage: ReturnType<HistoricalCoveragePlanner["plan"]> | null;
};

export class OandaHistoricalBackfillService {
  private progress: BackfillProgress = emptyProgress();

  constructor(private readonly historicalData: HistoricalDataImportService = historicalDataImportService) {}

  acquisitionPlan(now = new Date()): HistoricalDataAcquisitionPlan {
    const coverage = new HistoricalCoveragePlanner(this.historicalData).plan(now);
    return {
      generatedAt: now.toISOString(),
      targets: TARGET_YEARS,
      sourcePriority: ["OANDA practice candles", "local CSV import", "user-provided OHLCV archive", "demo fixture fallback"],
      items: coverage.items.map((item) => ({
        instrument: item.instrument,
        timeframe: item.timeframe,
        candlesAvailable: item.candlesAvailable,
        yearsAvailable: item.yearsAvailable,
        target: item.target,
        missingWindows: item.missingWindows,
        estimatedCandlesToMinimum: Math.max(0, expectedCandles(item.timeframe, TARGET_YEARS.minimum) - item.candlesAvailable),
        estimatedCandlesToPreferred: Math.max(0, expectedCandles(item.timeframe, TARGET_YEARS.preferred) - item.candlesAvailable),
        estimatedCandlesToIdeal: Math.max(0, expectedCandles(item.timeframe, TARGET_YEARS.ideal) - item.candlesAvailable),
        nextSource: item.target === "missing" || item.target === "below_minimum" ? "oanda_practice" : "csv_or_archive",
      })),
    };
  }

  status() {
    return this.progress;
  }

  stop() {
    this.progress = { ...this.progress, stopRequested: true, running: false, completedAt: new Date().toISOString(), warnings: [...this.progress.warnings, "Backfill stop requested."] };
    return this.progress;
  }

  async backfillOanda(options: OandaBackfillOptions = {}) {
    const env = options.env ?? process.env;
    if (env.OANDA_ENV?.trim().toLowerCase() !== "practice") throw new Error("OANDA historical backfill requires OANDA_ENV=practice");
    const token = env.OANDA_API_TOKEN;
    if (!token?.trim()) throw new Error("OANDA_API_TOKEN is not configured");

    const now = options.now ?? new Date();
    const runId = `oanda-backfill-${now.getTime()}`;
    const instruments = (options.instruments?.length ? options.instruments : [...RESEARCH_INSTRUMENTS]).map(normalizeInstrument);
    const timeframes = options.timeframes?.length ? options.timeframes : [...RESEARCH_TIMEFRAMES];
    const maxCandlesPerRequest = Math.min(Math.max(Math.floor(options.maxCandlesPerRequest ?? DEFAULT_MAX_CANDLES_PER_REQUEST), 1), 5000);
    const maxRequestsPerRun = Math.max(Math.floor(options.maxRequestsPerRun ?? DEFAULT_MAX_REQUESTS_PER_RUN), 1);
    const rateLimitMs = Math.max(Math.floor(options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS), 0);
    const end = options.end ? new Date(options.end) : now;
    const requestedStart = options.start ? new Date(options.start) : new Date(end.getTime() - TARGET_YEARS.minimum * 365 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(requestedStart.getTime()) || !Number.isFinite(end.getTime()) || requestedStart >= end) throw new Error("Valid start and end dates are required for OANDA backfill");

    this.progress = {
      ...emptyProgress(),
      runId,
      running: true,
      dryRun: Boolean(options.dryRun),
      startedAt: now.toISOString(),
      requestedWindows: instruments.length * timeframes.length,
      coverage: new HistoricalCoveragePlanner(this.historicalData).plan(now),
    };

    const fetcher = new OandaBackfillFetcher(env, options.fetchImpl ?? fetch);
    let requestsRemaining = maxRequestsPerRun;
    for (const instrument of instruments) {
      for (const timeframe of timeframes) {
        if (this.progress.stopRequested || requestsRemaining <= 0) break;
        const resumeStart = options.resume ? resumeCursor(this.historicalData, instrument, timeframe, requestedStart) : requestedStart;
        for (const window of buildWindows({ start: resumeStart, end, timeframe, maxCandlesPerRequest })) {
          if (this.progress.stopRequested || requestsRemaining <= 0) break;
          this.progress = {
            ...this.progress,
            currentInstrument: instrument,
            currentTimeframe: timeframe,
            cursor: window.from.toISOString(),
            estimatedCompletion: estimateCompletion(this.progress, requestsRemaining, rateLimitMs),
          };
          const candles = await fetcher.fetchCandles({ instrument, timeframe, from: window.from, to: window.to, maxCandles: maxCandlesPerRequest });
          validateOrdering(candles);
          this.progress = {
            ...this.progress,
            requestsCompleted: this.progress.requestsCompleted + 1,
            candlesFetched: this.progress.candlesFetched + candles.length,
          };
          if (!options.dryRun) {
            const imported = this.historicalData.importCandles({ candles, source: "provider", now });
            const coverage = this.historicalData.coverage(instrument, timeframe);
            this.progress = {
              ...this.progress,
              candlesImported: this.progress.candlesImported + imported.imported,
              duplicatesSkipped: this.progress.duplicatesSkipped + imported.duplicatesRemoved,
              gapsDetected: coverage.gaps.length,
              latestImportedAt: coverage.end,
              warnings: [...this.progress.warnings, ...imported.warnings],
            };
          }
          requestsRemaining -= 1;
          if (requestsRemaining > 0 && rateLimitMs > 0) await delay(rateLimitMs);
        }
      }
    }

    const completedAt = new Date().toISOString();
    this.progress = {
      ...this.progress,
      running: false,
      completedAt,
      cursor: null,
      estimatedCompletion: null,
      coverage: new HistoricalCoveragePlanner(this.historicalData).plan(new Date(completedAt)),
      warnings: requestsRemaining <= 0 ? [...this.progress.warnings, "Maximum requests per run reached; resume to continue."] : this.progress.warnings,
    };
    return this.progress;
  }
}

export class OandaBackfillFetcher {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchCandles(input: { instrument: string; timeframe: Candle["timeframe"]; from: Date; to: Date; maxCandles: number }): Promise<Array<Candle & { spread: null }>> {
    const token = this.env.OANDA_API_TOKEN;
    if (!token?.trim()) throw new Error("OANDA_API_TOKEN is not configured");
    const url = new URL(`https://api-fxpractice.oanda.com/v3/instruments/${encodeURIComponent(input.instrument)}/candles`);
    url.searchParams.set("price", "M");
    url.searchParams.set("granularity", granularity(input.timeframe));
    url.searchParams.set("from", input.from.toISOString());
    url.searchParams.set("to", input.to.toISOString());
    const response = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "MarketPilot-HistoricalBackfill/1.0" },
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 1);
      await delay(Math.max(0, retryAfter) * 1000);
      return this.fetchCandles(input);
    }
    if (!response.ok) throw new Error(`OANDA practice history backfill failed with status ${response.status}`);
    const payload = await response.json() as { candles?: Array<Record<string, unknown>> };
    return (payload.candles ?? []).filter((candle) => candle.complete !== false).map((candle) => {
      const mid = candle.mid as Record<string, unknown>;
      return {
        instrument: input.instrument,
        timeframe: input.timeframe,
        timestamp: new Date(String(candle.time)).toISOString(),
        open: Number(mid.o),
        high: Number(mid.h),
        low: Number(mid.l),
        close: Number(mid.c),
        volume: Number(candle.volume ?? 0),
        spread: null,
      };
    });
  }
}

export function buildWindows(input: { start: Date; end: Date; timeframe: Candle["timeframe"]; maxCandlesPerRequest: number }) {
  const windows: Array<{ from: Date; to: Date }> = [];
  const span = timeframeMs(input.timeframe) * input.maxCandlesPerRequest;
  for (let cursor = input.start.getTime(); cursor < input.end.getTime(); cursor += span) {
    windows.push({ from: new Date(cursor), to: new Date(Math.min(cursor + span, input.end.getTime())) });
  }
  return windows;
}

function resumeCursor(historicalData: HistoricalDataImportService, instrument: string, timeframe: Candle["timeframe"], requestedStart: Date) {
  const coverage = historicalData.coverage(instrument, timeframe);
  if (!coverage.end) return requestedStart;
  return new Date(Math.max(Date.parse(coverage.end) + timeframeMs(timeframe), requestedStart.getTime()));
}

function validateOrdering(candles: Candle[]) {
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].timestamp <= candles[index - 1].timestamp) throw new Error("Provider returned candles out of timestamp order");
  }
}

function estimateCompletion(progress: BackfillProgress, requestsRemaining: number, rateLimitMs: number) {
  if (!progress.startedAt || progress.requestsCompleted === 0) return null;
  const remainingMs = requestsRemaining * rateLimitMs;
  return new Date(Date.now() + remainingMs).toISOString();
}

function expectedCandles(timeframe: Candle["timeframe"], years: number) {
  return Math.ceil((years * 365 * 24 * 60 * 60 * 1000) / timeframeMs(timeframe));
}

function timeframeMs(timeframe: Candle["timeframe"]) {
  const minutes =
    timeframe === "1m" ? 1
      : timeframe === "5m" ? 5
        : timeframe === "15m" ? 15
          : timeframe === "30m" ? 30
            : timeframe === "1h" ? 60
              : timeframe === "4h" ? 240
                : timeframe === "1d" ? 1440
                  : timeframe === "1w" ? 10080
                    : timeframe === "1mo" ? 43200
                      : exhaustiveTimeframe(timeframe);
  return minutes * 60_000;
}

function granularity(timeframe: Candle["timeframe"]) {
  if (timeframe === "1m") return "M1";
  if (timeframe === "5m") return "M5";
  if (timeframe === "15m") return "M15";
  if (timeframe === "30m") return "M30";
  if (timeframe === "1h") return "H1";
  if (timeframe === "4h") return "H4";
  if (timeframe === "1d") return "D";
  if (timeframe === "1w") return "W";
  if (timeframe === "1mo") return "M";
  return exhaustiveTimeframe(timeframe);
}

function exhaustiveTimeframe(timeframe: never): never {
  throw new Error(`Unsupported timeframe: ${timeframe}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyProgress(): BackfillProgress {
  return {
    runId: null,
    running: false,
    stopRequested: false,
    dryRun: false,
    startedAt: null,
    completedAt: null,
    currentInstrument: null,
    currentTimeframe: null,
    cursor: null,
    requestedWindows: 0,
    requestsCompleted: 0,
    candlesFetched: 0,
    candlesImported: 0,
    duplicatesSkipped: 0,
    gapsDetected: 0,
    latestImportedAt: null,
    estimatedCompletion: null,
    warnings: [],
    coverage: null,
  };
}

export const oandaHistoricalBackfillService = new OandaHistoricalBackfillService();
