import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadHistoricalDatasetManifest, validateHistoricalDataset } from "../../server/v2/replay-verification";
import { historicalDatasetBuildRequestSchema, OandaHistoricalDatasetBuilder } from "../../server/v2/dataset-pipeline";
import { verifyOandaPracticeEnvironment } from "../../server/v2/dataset-pipeline/oanda";

if (has("--help") || has("-h")) {
  console.log(`Usage:
  npm run v2:dataset:oanda:build -- --symbols EUR_USD --timeframes M15,H1 --start <iso> --end <iso> --price bid_ask --output <dir> [--compression gzip] [--resume] [--dry-run]
  npm run v2:dataset:oanda:resume -- --symbols EUR_USD --timeframes M15,H1 --start <iso> --end <iso> --price bid_ask --output <dir>
  npm run v2:dataset:status -- --output <dir>
  npm run v2:dataset:resume -- --output <dir>
  npm run v2:dataset:validate -- --manifest <dir>/manifest.json`);
  process.exit(0);
}

const command = process.argv[1]?.includes("validate-dataset-manifest") ? "validate" : arg("--command") ?? "build";
if (command === "status") {
  const output = required("--output");
  const summaryPath = join(output, "acquisition-summary.json");
  console.log(existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : JSON.stringify({ state: "not_started" }));
  process.exit(0);
}
if (command === "validate") {
  const manifestPath = arg("--manifest") ?? join(required("--output"), "manifest.json");
  const loaded = loadHistoricalDatasetManifest(manifestPath);
  const validation = await validateHistoricalDataset(loaded);
  console.log(JSON.stringify(validation));
  if (!validation.ok) process.exit(1);
  process.exit(0);
}

const request = historicalDatasetBuildRequestSchema.parse({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: required("--symbols").split(",").map(value => value.trim()).filter(Boolean),
  timeframes: required("--timeframes").split(",").map(normalizeTimeframe).filter(Boolean),
  startTime: required("--start"),
  endTime: required("--end"),
  priceComponent: arg("--price") ?? "bid_ask",
  outputDirectory: required("--output"),
  datasetId: arg("--dataset-id"),
  datasetVersion: arg("--dataset-version"),
  partitionPolicy: { strategy: arg("--partition") ?? "symbol_timeframe", format: "jsonl", compression: arg("--compression") ?? "none", maxRecordsPerPartition: Number(arg("--max-records-per-partition") ?? 100000) },
  resume: has("--resume") || command === "resume",
  overwrite: false,
  maxCandlesPerRequest: Number(arg("--max-candles-per-request") ?? 5000),
  rateLimitMs: Number(arg("--rate-limit-ms") ?? 250),
  maxRetries: Number(arg("--max-retries") ?? 2),
  allowIncompleteFinalCandle: has("--allow-incomplete-final-candle"),
});

if (has("--dry-run")) {
  verifyOandaPracticeEnvironment(process.env);
  console.log(JSON.stringify({ dryRun: true, request: { ...request, outputDirectory: request.outputDirectory }, windows: "bounded by maxCandlesPerRequest", externalCalls: 0 }, null, 2));
  process.exit(0);
}

const result = await new OandaHistoricalDatasetBuilder().build(request);
console.log(JSON.stringify(result, null, 2));
if (result.validationStatus === "failed") process.exit(1);

function has(name: string) { return process.argv.includes(name); }
function arg(name: string) { return has(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined; }
function required(name: string) { const value = arg(name); if (!value) throw new Error(`${name} is required`); return value; }
function normalizeTimeframe(value: string) {
  const normalized = value.trim();
  const aliases: Record<string, string> = { M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D: "1d", W: "1w", M: "1mo" };
  return aliases[normalized.toUpperCase()] ?? normalized;
}
