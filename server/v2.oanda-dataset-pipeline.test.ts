import assert from "node:assert/strict";
import { rmSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { OandaHistoricalDatasetBuilder, oandaGranularity, verifyOandaPracticeEnvironment, type OandaHistoricalClient, type OandaRawCandle } from "./v2/dataset-pipeline";
import { HistoricalDatasetReplaySource, loadHistoricalDatasetManifest, ReplayVerificationService, validateHistoricalDataset } from "./v2/replay-verification";

async function main() {
const output = "artifacts/v2-replay/oanda-dataset-test";
rmSync(output, { recursive: true, force: true });
for (const suffix of ["retry", "auth", "csv", "count", "unsupported"]) rmSync(`${output}-${suffix}`, { recursive: true, force: true });

assert.equal(oandaGranularity("1m"), "M1");
assert.equal(oandaGranularity("5m"), "M5");
assert.equal(oandaGranularity("15m"), "M15");
assert.equal(oandaGranularity("30m"), "M30");
assert.equal(oandaGranularity("1h"), "H1");
assert.equal(oandaGranularity("4h"), "H4");
assert.equal(oandaGranularity("1d"), "D");
assert.equal(oandaGranularity("1w"), "W");
assert.equal(oandaGranularity("1mo"), "M");
assert.throws(() => verifyOandaPracticeEnvironment({ OANDA_ENV: "live", OANDA_API_TOKEN: "x", OANDA_ACCOUNT_ID: "acct", MARKETPILOT_DEMO_ONLY: "true" }), /practice/);
assert.throws(() => verifyOandaPracticeEnvironment({ OANDA_ENV: "practice", OANDA_API_TOKEN: "x", OANDA_ACCOUNT_ID: "acct", MARKETPILOT_DEMO_ONLY: "true", OANDA_BASE_URL: "https://api-fxtrade.oanda.com/v3" }), /live endpoint/);

const client = new MockOandaClient();
const result = await new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD", "GBP_USD"],
  timeframes: ["15m", "1h"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-06T02:00:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: output,
  partitionPolicy: { strategy: "symbol_timeframe", format: "jsonl", compression: "gzip", maxRecordsPerPartition: 1000 },
  resume: false,
  overwrite: false,
  maxCandlesPerRequest: 3,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
});

assert.equal(result.validationStatus, "passed");
assert.equal(result.symbols.join(","), "EUR_USD,GBP_USD");
assert.ok(result.candleCount > 0);
assert.ok(result.duplicatesSuppressed > 0);
assert.equal(client.orderEndpointCalls, 0);
assert.ok(client.calls.length > 2);
assert.ok(client.rateLimitResponses > 0);

const loaded = loadHistoricalDatasetManifest(result.manifestPath);
assert.equal(loaded.manifestHash, result.manifestHash);
const validation = await validateHistoricalDataset(loaded);
assert.equal(validation.ok, true);
assert.ok(loaded.manifest.partitions.every(partition => partition.compression === "gzip"));

const callsAfterInitialBuild = client.calls.length;
const resumed = await new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD", "GBP_USD"],
  timeframes: ["15m", "1h"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-06T02:00:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: output,
  partitionPolicy: { strategy: "symbol_timeframe", format: "jsonl", compression: "gzip", maxRecordsPerPartition: 1000 },
  resume: true,
  overwrite: false,
  maxCandlesPerRequest: 3,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
});
assert.equal(resumed.resumed, true);
assert.equal(resumed.candleCount, result.candleCount);
assert.equal(client.calls.length, callsAfterInitialBuild);
await assert.rejects(new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({ ...{
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1" as const,
  provider: "oanda" as const,
  environment: "practice" as const,
  symbols: ["EUR_USD", "GBP_USD"],
  timeframes: ["15m" as const, "1h" as const],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-06T02:00:00.000Z",
  priceComponent: "bid_ask" as const,
  outputDirectory: output,
  partitionPolicy: { strategy: "symbol_timeframe" as const, format: "jsonl" as const, compression: "gzip" as const, maxRecordsPerPartition: 1000 },
  resume: true,
  overwrite: false as const,
  maxCandlesPerRequest: 3,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
}, priceComponent: "mid" }), /checkpoint does not match/);

const source = new HistoricalDatasetReplaySource({ manifest: loaded.manifest, manifestHash: loaded.manifestHash, rootDirectory: loaded.rootDirectory, start: "2020-01-03T21:00:00.000Z", end: "2020-01-06T02:00:00.000Z", symbols: ["EUR_USD", "GBP_USD"], timeframes: ["15m", "1h"] });
const replayManifest = {
  manifestVersion: "fincoach.v2.replay-manifest.1" as const,
  inputMode: "historical" as const,
  runId: "oanda-dataset-pipeline-replay",
  repositoryCommit: "local-dev",
  startedAt: "2026-01-01T00:00:00.000Z",
  datasetId: loaded.manifest.datasetId,
  datasetVersion: loaded.manifest.datasetVersion,
  datasetHashes: { datasetManifest: loaded.manifestHash },
  symbols: ["EUR_USD", "GBP_USD"],
  timeframes: ["15m", "1h"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-06T02:00:00.000Z",
  replayMode: "custom" as const,
  seed: 42,
  checkpointInterval: 2,
  restartSchedule: [2],
  workerCount: 1,
  resourceLimits: { maxEvents: 1000, maxHeapMb: 512 },
  featureSchemaVersions: { features: "fincoach.v2.features.1" },
  eventSchemaVersions: { replay: "fincoach.v2.event.1", historicalDataset: loaded.manifest.schemaVersion },
  expectedSafetyState: { liveExecutionBlocked: true as const, brokerCallsAllowed: false as const, telegramAllowed: false as const },
  outputDirectory: join(output, "replay"),
  historicalDataset: { manifestPath: result.manifestPath, manifestHash: result.manifestHash },
};
const replay = await new ReplayVerificationService().runFromSource({ manifest: replayManifest, source, batchSize: 2 });
assert.equal(replay.status, "passed", JSON.stringify(replay.failures));
assert.equal(replay.safety.brokerCalls, 0);
assert.equal(replay.safety.telegramMessages, 0);

const retrySleeps: number[] = [];
const transientClient = new TransientOandaClient();
const retryResult = await new OandaHistoricalDatasetBuilder({ env: safeEnv(), client: transientClient, now: () => new Date("2026-01-01T00:00:00.000Z"), sleeper: async (ms) => { retrySleeps.push(ms); } }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD"],
  timeframes: ["15m"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-03T21:15:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: `${output}-retry`,
  partitionPolicy: { strategy: "symbol_timeframe", format: "jsonl", compression: "none", maxRecordsPerPartition: 1000 },
  resume: false,
  overwrite: false,
  maxCandlesPerRequest: 1,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
});
assert.equal(retryResult.validationStatus, "passed");
assert.deepEqual(retrySleeps, [250]);

await assert.rejects(new OandaHistoricalDatasetBuilder({ env: safeEnv(), client: new AuthFailureOandaClient(), now: () => new Date("2026-01-01T00:00:00.000Z"), sleeper: async () => { throw new Error("auth failure should not sleep"); } }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD"],
  timeframes: ["15m"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-03T21:15:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: `${output}-auth`,
  partitionPolicy: { strategy: "symbol_timeframe", format: "jsonl", compression: "none", maxRecordsPerPartition: 1000 },
  resume: false,
  overwrite: false,
  maxCandlesPerRequest: 1,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
}), /401/);

await assert.rejects(new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD"],
  timeframes: ["15m"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-03T21:15:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: `${output}-csv`,
  partitionPolicy: { strategy: "symbol_timeframe", format: "csv" as "jsonl", compression: "none", maxRecordsPerPartition: 1000 },
  resume: false,
  overwrite: false,
  maxCandlesPerRequest: 1,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
}), /Invalid enum value|invalid/i);

await assert.rejects(new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1",
  provider: "oanda",
  environment: "practice",
  symbols: ["EUR_USD"],
  timeframes: ["15m"],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-03T21:15:00.000Z",
  priceComponent: "bid_ask",
  outputDirectory: `${output}-count`,
  partitionPolicy: { strategy: "symbol_timeframe", format: "jsonl", compression: "none", maxRecordsPerPartition: 1000 },
  resume: false,
  overwrite: false,
  maxCandlesPerRequest: 5001,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
}), /too_big|Number must be less than or equal to 5000|5000/i);

await assert.rejects(new OandaHistoricalDatasetBuilder({ env: safeEnv(), client, now: () => new Date("2026-01-01T00:00:00.000Z") }).build({ ...{
  schemaVersion: "fincoach.v2.oanda-dataset-build-request.1" as const,
  provider: "oanda" as const,
  environment: "practice" as const,
  symbols: ["EUR_USD"],
  timeframes: ["15m" as const],
  startTime: "2020-01-03T21:00:00.000Z",
  endTime: "2020-01-03T22:00:00.000Z",
  priceComponent: "bid_ask" as const,
  outputDirectory: `${output}-unsupported`,
  partitionPolicy: { strategy: "symbol_timeframe" as const, format: "jsonl" as const, compression: "none" as const, maxRecordsPerPartition: 1000 },
  resume: true,
  overwrite: false as const,
  maxCandlesPerRequest: 3,
  rateLimitMs: 0,
  maxRetries: 2,
  allowIncompleteFinalCandle: false,
}, symbols: ["USD_CAD"] }), /Unsupported OANDA practice instrument/);

const dryRun = execFileSync("npm", ["run", "v2:dataset:oanda:build", "--", "--symbols", "EUR_USD", "--timeframes", "15m", "--start", "2020-01-01T00:00:00.000Z", "--end", "2020-01-02T00:00:00.000Z", "--price", "bid_ask", "--output", "artifacts/v2-replay/dry-oanda", "--dry-run"], { encoding: "utf8", env: { ...process.env, ...safeEnv() } });
assert.match(dryRun, /"dryRun": true/);
const help = execFileSync("npm", ["run", "v2:dataset:oanda:build", "--", "--help"], { encoding: "utf8" });
assert.match(help, /v2:dataset:oanda:build/);

console.log("v2 oanda dataset pipeline tests passed", JSON.stringify({ candles: result.candleCount, partitions: result.partitionCount, duplicates: result.duplicatesSuppressed, requests: client.calls.length, replayEvents: replay.inputEventCount }));
}

function safeEnv() {
  return { OANDA_ENV: "practice", OANDA_API_TOKEN: "test-token", OANDA_ACCOUNT_ID: "test-account", MARKETPILOT_DEMO_ONLY: "true", FINCOACH_LIVE_EXECUTION: "blocked" };
}

class MockOandaClient implements OandaHistoricalClient {
  calls: Array<{ instrument: string; granularity: string; from: string; to: string; price: string }> = [];
  rateLimitResponses = 0;
  orderEndpointCalls = 0;
  async listInstruments() { return ["EUR_USD", "GBP_USD"]; }
  async fetchCandles(input: { instrument: string; granularity: string; from: string; to: string; price: string; count: number }) {
    this.calls.push(input);
    if (this.calls.length === 1) { this.rateLimitResponses += 1; return { candles: [], requestId: "rate-limit", retryAfterMs: 0 }; }
    const start = Date.parse(input.from);
    const step = input.granularity === "H1" ? 3_600_000 : 900_000;
    const candles: OandaRawCandle[] = [0, 1, 1, 2].map((index) => candle(input.instrument, new Date(start + index * step).toISOString(), index));
    candles.push({ ...candle(input.instrument, new Date(start + 3 * step).toISOString(), 3), complete: false });
    return { candles, requestId: `request-${this.calls.length}`, retryAfterMs: null };
  }
}

class TransientOandaClient extends MockOandaClient {
  failed = false;
  async fetchCandles(input: { instrument: string; granularity: string; from: string; to: string; price: string; count: number }) {
    if (!this.failed) {
      this.failed = true;
      const error = new Error("socket hang up");
      (error as Error & { code: string }).code = "ECONNRESET";
      throw error;
    }
    return super.fetchCandles(input);
  }
}

class AuthFailureOandaClient extends MockOandaClient {
  async fetchCandles() {
    throw new Error("OANDA historical candles failed with status 401");
  }
}

function candle(instrument: string, time: string, index: number): OandaRawCandle {
  const base = instrument === "GBP_USD" ? 1.28 : 1.1;
  const bid = base + index * 0.0001;
  const ask = bid + 0.0002;
  return { time, complete: true, volume: 100 + index, bid: ohlc(bid), ask: ohlc(ask) };
}
function ohlc(open: number) {
  return { o: open.toFixed(5), h: (open + 0.0003).toFixed(5), l: (open - 0.0002).toFixed(5), c: (open + 0.0001).toFixed(5) };
}

await main();
