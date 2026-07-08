import { normalizeInstrument, type Candle } from "./strategy-machine/market-data";

export type HistoricalCandle = Candle & {
  spread: number | null;
  session: "asia" | "london" | "new_york" | "overlap" | "off_hours";
  volatility: "compressed" | "normal" | "expanded";
};

export type HistoricalImportStatus = {
  source: "csv" | "provider" | "demo";
  imported: number;
  duplicatesRemoved: number;
  rejected: number;
  warnings: string[];
  startedAt: string;
  completedAt: string;
};

export type HistoricalDataCoverage = {
  instrument: string;
  timeframe: Candle["timeframe"];
  candlesAvailable: number;
  start: string | null;
  end: string | null;
  sessionsCovered: string[];
  volatilityRegimesCovered: string[];
  gaps: Array<{ from: string; to: string; missingCandles: number }>;
  warnings: string[];
};

export type BacktestSampleDepthReport = {
  candlesAvailable: number;
  dateRange: { start: string | null; end: string | null };
  instrumentsCovered: string[];
  timeframesCovered: string[];
  regimesCovered: string[];
  sessionsCovered: string[];
  missingDataWarnings: string[];
};

export type CandleProvider = {
  fetchCandles(input: { instrument: string; timeframe: Candle["timeframe"]; count: number }): Promise<Array<Candle & { spread?: number | null }>>;
};

export class HistoricalDataImportService {
  private readonly candles = new Map<string, HistoricalCandle>();
  private latestStatus: HistoricalImportStatus | null = null;

  importCsv(input: { csv: string; defaultInstrument?: string; defaultTimeframe?: Candle["timeframe"]; now?: Date }) {
    const startedAt = (input.now ?? new Date()).toISOString();
    const rows = parseCsv(input.csv);
    if (rows.length === 0) throw new Error("CSV contains no rows");
    const imported: Array<Candle & { spread?: number | null }> = [];
    const warnings: string[] = [];
    let rejected = 0;
    for (const row of rows) {
      try {
        imported.push(rowToCandle(row, input.defaultInstrument, input.defaultTimeframe));
      } catch (error) {
        rejected += 1;
        warnings.push(error instanceof Error ? error.message : "Malformed CSV row rejected");
      }
    }
    if (imported.length === 0) throw new Error(`CSV import rejected all rows: ${warnings.join("; ")}`);
    const result = this.store(imported, "csv", startedAt, warnings, rejected);
    return result;
  }

  async importFromProvider(input: { provider: CandleProvider; instrument: string; timeframe: Candle["timeframe"]; count: number; now?: Date }) {
    const startedAt = (input.now ?? new Date()).toISOString();
    const candles = await input.provider.fetchCandles({
      instrument: normalizeInstrument(input.instrument),
      timeframe: input.timeframe,
      count: input.count,
    });
    return this.store(candles, "provider", startedAt, [], 0);
  }

  importCandles(input: { candles: Array<Candle & { spread?: number | null }>; source?: HistoricalImportStatus["source"]; warnings?: string[]; rejected?: number; now?: Date }) {
    const startedAt = (input.now ?? new Date()).toISOString();
    return this.store(input.candles, input.source ?? "provider", startedAt, input.warnings ?? [], input.rejected ?? 0);
  }

  ensureDemoHistory(input: { instruments: string[]; timeframe?: Candle["timeframe"]; count?: number; now?: Date }) {
    const timeframe = input.timeframe ?? "15m";
    const count = input.count ?? 420;
    const startedAt = (input.now ?? new Date()).toISOString();
    const candles = input.instruments.flatMap((instrument) => demoHistory(instrument, timeframe, count, input.now ?? new Date()));
    return this.store(candles, "demo", startedAt, [], 0);
  }

  getCandles(instrument: string, timeframe: Candle["timeframe"], limit?: number): HistoricalCandle[] {
    const normalized = normalizeInstrument(instrument);
    const values = Array.from(this.candles.values())
      .filter((candle) => candle.instrument === normalized && candle.timeframe === timeframe)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    return limit ? values.slice(-limit) : values;
  }

  coverage(instrument: string, timeframe: Candle["timeframe"]): HistoricalDataCoverage {
    const candles = this.getCandles(instrument, timeframe);
    const gaps = detectGaps(candles, timeframe);
    const warnings = [
      candles.length < 120 ? `Only ${candles.length} candles available; deeper history is recommended.` : null,
      gaps.length ? `${gaps.length} timestamp gap(s) detected.` : null,
      new Set(candles.map((candle) => candle.session)).size < 3 ? "Session coverage is narrow." : null,
      new Set(candles.map((candle) => candle.volatility)).size < 2 ? "Volatility regime coverage is narrow." : null,
    ].filter((warning): warning is string => Boolean(warning));
    return {
      instrument: normalizeInstrument(instrument),
      timeframe,
      candlesAvailable: candles.length,
      start: candles[0]?.timestamp ?? null,
      end: candles[candles.length - 1]?.timestamp ?? null,
      sessionsCovered: Array.from(new Set(candles.map((candle) => candle.session))).sort(),
      volatilityRegimesCovered: Array.from(new Set(candles.map((candle) => candle.volatility))).sort(),
      gaps,
      warnings,
    };
  }

  coverageSnapshot(instruments: string[], timeframe: Candle["timeframe"]) {
    return instruments.map((instrument) => this.coverage(instrument, timeframe));
  }

  sampleDepth(candles: HistoricalCandle[] | Candle[]): BacktestSampleDepthReport {
    const sorted = [...candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const enriched = sorted.map((candle) => "session" in candle ? candle as HistoricalCandle : enrichCandle(candle));
    return {
      candlesAvailable: enriched.length,
      dateRange: { start: enriched[0]?.timestamp ?? null, end: enriched[enriched.length - 1]?.timestamp ?? null },
      instrumentsCovered: Array.from(new Set(enriched.map((candle) => candle.instrument))).sort(),
      timeframesCovered: Array.from(new Set(enriched.map((candle) => candle.timeframe))).sort(),
      regimesCovered: Array.from(new Set(enriched.map((candle) => candle.volatility))).sort(),
      sessionsCovered: Array.from(new Set(enriched.map((candle) => candle.session))).sort(),
      missingDataWarnings: [
        enriched.length < 120 ? `Backtest has ${enriched.length} candles; prefer at least 120 for research context.` : null,
        detectGaps(enriched, enriched[0]?.timeframe ?? "15m").length ? "Backtest sample contains timestamp gaps." : null,
        new Set(enriched.map((candle) => candle.session)).size < 3 ? "Backtest session coverage is narrow." : null,
        new Set(enriched.map((candle) => candle.volatility)).size < 2 ? "Backtest volatility regime coverage is narrow." : null,
      ].filter((warning): warning is string => Boolean(warning)),
    };
  }

  latestImportStatus() {
    return this.latestStatus;
  }

  clearForTest() {
    this.candles.clear();
    this.latestStatus = null;
  }

  private store(candles: Array<Candle & { spread?: number | null }>, source: HistoricalImportStatus["source"], startedAt: string, warnings: string[], rejected: number): HistoricalImportStatus {
    const before = this.candles.size;
    const normalized = candles.map((candle) => enrichCandle(candle));
    for (const candle of normalized) {
      this.candles.set(key(candle), candle);
    }
    const imported = Math.max(0, this.candles.size - before);
    const duplicatesRemoved = Math.max(0, normalized.length - imported);
    this.latestStatus = {
      source,
      imported,
      duplicatesRemoved,
      rejected,
      warnings: [...warnings],
      startedAt,
      completedAt: new Date().toISOString(),
    };
    return this.latestStatus;
  }
}

function parseCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split(",").map((item) => item.trim()) ?? [];
  if (!headers.includes("timestamp") || !headers.includes("open") || !headers.includes("high") || !headers.includes("low") || !headers.includes("close")) {
    throw new Error("CSV must include timestamp, open, high, low, and close headers");
  }
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()])));
}

function rowToCandle(row: Record<string, string>, defaultInstrument?: string, defaultTimeframe?: Candle["timeframe"]): Candle & { spread?: number | null } {
  const instrument = normalizeInstrument(row.instrument || defaultInstrument || "");
  const timeframe = (row.timeframe || defaultTimeframe || "15m") as Candle["timeframe"];
  const timestamp = new Date(row.timestamp).toISOString();
  const open = numeric(row.open, "open");
  const high = numeric(row.high, "high");
  const low = numeric(row.low, "low");
  const close = numeric(row.close, "close");
  if (!instrument) throw new Error("CSV row missing instrument");
  if (high < Math.max(open, close) || low > Math.min(open, close)) throw new Error("CSV row has invalid OHLC range");
  return {
    instrument,
    timeframe,
    timestamp,
    open,
    high,
    low,
    close,
    volume: Number(row.volume ?? 0) || 0,
    spread: row.spread === undefined || row.spread === "" ? null : Number(row.spread),
  };
}

function enrichCandle(candle: Candle & { spread?: number | null }): HistoricalCandle {
  return {
    ...candle,
    instrument: normalizeInstrument(candle.instrument),
    spread: candle.spread ?? null,
    session: sessionFor(candle.timestamp),
    volatility: volatilityFor(candle),
  };
}

function detectGaps(candles: Candle[], timeframe: Candle["timeframe"]) {
  const expected = timeframeMs(timeframe);
  return candles.slice(1).flatMap((candle, index) => {
    const previous = candles[index];
    const delta = Date.parse(candle.timestamp) - Date.parse(previous.timestamp);
    if (delta <= expected * 1.5) return [];
    return [{ from: previous.timestamp, to: candle.timestamp, missingCandles: Math.max(1, Math.round(delta / expected) - 1) }];
  });
}

function sessionFor(timestamp: string): HistoricalCandle["session"] {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 7 && hour < 12) return "london";
  if (hour >= 12 && hour < 16) return "overlap";
  if (hour >= 16 && hour < 21) return "new_york";
  if (hour >= 0 && hour < 7) return "asia";
  return "off_hours";
}

function volatilityFor(candle: Candle): HistoricalCandle["volatility"] {
  const rangePct = Math.abs(candle.high - candle.low) / Math.max(Math.abs(candle.close), 0.000001);
  if (rangePct < 0.00065) return "compressed";
  if (rangePct > 0.0018) return "expanded";
  return "normal";
}

function demoHistory(instrument: string, timeframe: Candle["timeframe"], count: number, now: Date): Array<Candle & { spread?: number | null }> {
  const normalized = normalizeInstrument(instrument);
  const step = timeframeMs(timeframe);
  const pip = normalized.includes("JPY") ? 0.01 : normalized.startsWith("XAU") ? 0.8 : normalized.startsWith("XAG") ? 0.04 : 0.0001;
  const base = normalized === "USD_JPY" ? 158 : normalized === "XAU_USD" ? 2350 : normalized === "XAG_USD" ? 31 : normalized === "GBP_USD" ? 1.28 : 1.1;
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(now.getTime() - (count - index) * step).toISOString();
    const regime = Math.floor(index / 70) % 3;
    const trend = regime === 0 ? index * pip * 0.05 : regime === 1 ? -index * pip * 0.02 : index * pip * 0.03;
    const wave = Math.sin(index / 6) * pip * (regime + 1);
    const range = pip * (regime === 0 ? 1.1 : regime === 1 ? 2.4 : 0.45);
    const recent = count - index;
    const sweep = recent === 2 ? -pip * 4 : 0;
    const breakout = recent === 1 ? pip * 8 : 0;
    const open = base + trend + wave + sweep;
    const close = open + Math.cos(index / 5) * pip * 0.7 + breakout;
    const recentCompression = recent > 1 && recent < 18 ? pip * 0.35 : range;
    return {
      instrument: normalized,
      timeframe,
      timestamp,
      open: round(open),
      high: round(Math.max(open, close) + recentCompression),
      low: round(Math.min(open, close) - recentCompression - (recent === 2 ? pip * 4 : 0)),
      close: round(close),
      volume: 100 + index,
      spread: normalized.startsWith("XAU") ? 0.2 : normalized.startsWith("XAG") ? 0.02 : normalized.includes("JPY") ? 0.01 : 0.00012,
    };
  });
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

function exhaustiveTimeframe(timeframe: never): never {
  throw new Error(`Unsupported timeframe: ${timeframe}`);
}

function numeric(value: string | undefined, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CSV row has invalid ${field}`);
  return parsed;
}

function key(candle: Candle) {
  return `${candle.instrument}:${candle.timeframe}:${candle.timestamp}`;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const historicalDataImportService = new HistoricalDataImportService();
