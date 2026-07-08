import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { oandaHistoricalBackfillService } from "../server/historicalDataBackfillService";
import type { Candle } from "../server/strategy-machine/market-data";

type BatchJob = {
  symbol: string;
  timeframe: Candle["timeframe"];
  years: number;
};

type BatchState = {
  completed: string[];
  failed: { key: string; reason: string }[];
};

const DEFAULT_BATCH_SYMBOLS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "USD/CAD",
  "AUD/USD", "NZD/USD", "EUR/GBP", "EUR/JPY", "EUR/CHF",
  "EUR/AUD", "EUR/CAD", "EUR/NZD", "GBP/JPY", "GBP/CHF",
  "GBP/AUD", "GBP/CAD", "AUD/JPY", "AUD/NZD", "AUD/CAD",
  "CAD/JPY", "CHF/JPY", "NZD/JPY", "NZD/CAD", "AUD/CHF",
  "NZD/CHF", "CAD/CHF", "XAU/USD", "XAG/USD", "WTI",
];

const DEFAULT_BATCH_TIMEFRAMES: Candle["timeframe"][] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1mo",
];

const SUPPORTED_TIMEFRAMES = new Set<Candle["timeframe"]>(DEFAULT_BATCH_TIMEFRAMES);

try {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log([
      "Usage:",
      "  tsx script/backfill-oanda-history.ts --dry-run --symbol EUR/USD --timeframe 1h --days 30",
      "  tsx script/backfill-oanda-history.ts --symbol EUR/USD --timeframe 15m --years 1 --real",
      "  tsx script/backfill-oanda-history.ts --all --years 1 --real",
      "  tsx script/backfill-oanda-history.ts --resume --all --years 1 --real",
      "",
      "Batch mode:",
      "  tsx script/backfill-oanda-history.ts --batch --years 6 --real",
      "  tsx script/backfill-oanda-history.ts --batch --symbols EUR/USD,GBP/USD --timeframes 1h,4h,1d --years 6 --real",
      "  tsx script/backfill-oanda-history.ts --batch --years 6 --real --delay-ms 3000",
      "",
      "Defaults: dry-run, resume enabled, OANDA practice only.",
    ].join("\n"));
    process.exit(0);
  }

  if (args.batch) {
    await runBatch(args);
  } else {
    const status = await runSingle(args);
    printStatus(status);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "OANDA historical backfill failed");
  process.exit(1);
}

async function runSingle(parsed: ReturnType<typeof parseArgs>) {
  const now = new Date();
  const end = parsed.end ?? now.toISOString();
  const start =
    parsed.start ??
    new Date(Date.parse(end) - (parsed.days ?? parsed.years * 365) * 24 * 60 * 60 * 1000).toISOString();

  return oandaHistoricalBackfillService.backfillOanda({
    instruments: parsed.all ? undefined : parsed.symbols,
    timeframes: parsed.timeframes,
    start,
    end,
    maxCandlesPerRequest: parsed.maxCandlesPerRequest,
    maxRequestsPerRun: parsed.maxRequestsPerRun,
    dryRun: !parsed.real,
    resume: parsed.resume,
  });
}

async function runBatch(parsed: ReturnType<typeof parseArgs>) {
  const state = loadBatchState(parsed.batchStateFile);
  const symbols = parsed.symbols?.length ? parsed.symbols : DEFAULT_BATCH_SYMBOLS;
  const timeframes = parsed.timeframes?.length ? parsed.timeframes : DEFAULT_BATCH_TIMEFRAMES;

  const jobs: BatchJob[] = [];
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      jobs.push({ symbol, timeframe, years: parsed.years });
    }
  }

  const pending = jobs.filter((job) => !state.completed.includes(batchJobKey(job)));

  console.log(JSON.stringify({
    mode: "batch",
    dryRun: !parsed.real,
    years: parsed.years,
    totalJobs: jobs.length,
    completed: state.completed.length,
    pending: pending.length,
    failed: state.failed.length,
    symbols,
    timeframes,
    delayMs: parsed.delayMs,
    stateFile: parsed.batchStateFile,
  }, null, 2));

  for (const job of pending) {
    const key = batchJobKey(job);
    console.log(`\n=== Backfilling ${key} ===`);

    try {
      const status = await runSingle({
        ...parsed,
        batch: false,
        all: false,
        symbols: [job.symbol],
        timeframes: [job.timeframe],
        years: job.years,
      });

      printStatus(status);

      state.completed.push(key);
      state.failed = state.failed.filter((failure) => failure.key !== key);
      saveBatchState(parsed.batchStateFile, state);

      console.log(`Completed: ${key}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.failed.push({ key, reason });
      saveBatchState(parsed.batchStateFile, state);

      console.error(`Failed: ${key}`);
      console.error(reason);

      if (parsed.stopOnFailure) {
        throw error;
      }
    }

    if (parsed.delayMs > 0) {
      await wait(parsed.delayMs);
    }
  }

  console.log(JSON.stringify({
    mode: "batch_complete",
    completed: state.completed.length,
    failed: state.failed.length,
    stateFile: parsed.batchStateFile,
  }, null, 2));

  if (state.failed.length > 0) {
    console.log("Failed jobs:");
    for (const failure of state.failed) {
      console.log(`- ${failure.key}: ${failure.reason}`);
    }
  }
}

function printStatus(status: Awaited<ReturnType<typeof oandaHistoricalBackfillService.backfillOanda>>) {
  console.log(JSON.stringify({
    dryRun: status.dryRun,
    requestsCompleted: status.requestsCompleted,
    candlesFetched: status.candlesFetched,
    candlesImported: status.candlesImported,
    duplicatesSkipped: status.duplicatesSkipped,
    gapsDetected: status.gapsDetected,
    latestImportedAt: status.latestImportedAt,
    warnings: status.warnings,
  }, null, 2));
}

function batchJobKey(job: BatchJob) {
  return `${job.symbol}|${job.timeframe}|${job.years}`;
}

function loadBatchState(path: string): BatchState {
  if (!existsSync(path)) return { completed: [], failed: [] };
  return JSON.parse(readFileSync(path, "utf8")) as BatchState;
}

function saveBatchState(path: string, state: BatchState) {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(values: string[]) {
  const parsed = {
    help: false,
    all: false,
    real: false,
    resume: true,
    batch: false,
    stopOnFailure: false,
    symbols: undefined as string[] | undefined,
    timeframes: undefined as Candle["timeframe"][] | undefined,
    start: undefined as string | undefined,
    end: undefined as string | undefined,
    years: 1,
    days: undefined as number | undefined,
    maxCandlesPerRequest: undefined as number | undefined,
    maxRequestsPerRun: undefined as number | undefined,
    delayMs: 3000,
    batchStateFile: "backfill-oanda-batch-state.json",
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];

    if (value === "--help" || value === "-h") parsed.help = true;
    if (value === "--all") parsed.all = true;
    if (value === "--real") parsed.real = true;
    if (value === "--dry-run") parsed.real = false;
    if (value === "--resume") parsed.resume = true;
    if (value === "--no-resume") parsed.resume = false;
    if (value === "--batch") parsed.batch = true;
    if (value === "--stop-on-failure") parsed.stopOnFailure = true;

    if ((value === "--symbol" || value === "--symbols") && next) {
      parsed.symbols = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    }

    if ((value === "--timeframe" || value === "--timeframes") && next) {
      parsed.timeframes = next.split(",").map(parseTimeframe).filter((item): item is Candle["timeframe"] => item !== undefined);
      index += 1;
    }

    if (value === "--start" && next) {
      parsed.start = new Date(next).toISOString();
      index += 1;
    }

    if (value === "--end" && next) {
      parsed.end = new Date(next).toISOString();
      index += 1;
    }

    if (value === "--years" && next) {
      parsed.years = Math.max(1, Number(next));
      index += 1;
    }

    if (value === "--days" && next) {
      parsed.days = Math.max(1, Number(next));
      index += 1;
    }

    if (value === "--max-candles-per-request" && next) {
      parsed.maxCandlesPerRequest = Number(next);
      index += 1;
    }

    if (value === "--max-requests-per-run" && next) {
      parsed.maxRequestsPerRun = Number(next);
      index += 1;
    }

    if (value === "--delay-ms" && next) {
      parsed.delayMs = Math.max(0, Number(next));
      index += 1;
    }

    if (value === "--batch-state-file" && next) {
      parsed.batchStateFile = next;
      index += 1;
    }
  }

  return parsed;
}

function parseTimeframe(value: string): Candle["timeframe"] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (SUPPORTED_TIMEFRAMES.has(trimmed as Candle["timeframe"])) {
    return trimmed as Candle["timeframe"];
  }
  throw new Error(`Unsupported timeframe "${trimmed}". Use one of: ${DEFAULT_BATCH_TIMEFRAMES.join(", ")}`);
}
