import { createHash, randomUUID } from "crypto";
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import { MarketDataV2Service, type NormalizedCandle, type V2Timeframe } from "../market-data";
import { hashFile, hashHistoricalDatasetManifest, type HistoricalReplayDatasetManifest, type HistoricalReplayPartition, type HistoricalReplayRecord, validateHistoricalDataset } from "../replay-verification";
import { historicalDatasetBuildRequestSchema, type HistoricalDatasetBuildRequest, type HistoricalDatasetBuildResult, type OandaDatasetBuildEnv, type OandaHistoricalClient, type OandaRawCandle } from "./contracts";
import { oandaGranularity, oandaPriceParameter, OandaPracticeHistoricalClient, verifyOandaPracticeEnvironment, waitForRateLimit } from "./oanda";

const BUILDER_VERSION = "fincoach.v2.oanda-dataset-builder.1";

export class OandaHistoricalDatasetBuilder {
  private readonly marketData = new MarketDataV2Service();
  constructor(private readonly input: { env?: OandaDatasetBuildEnv; client?: OandaHistoricalClient; fetchImpl?: typeof fetch; now?: () => Date } = {}) {}

  async build(requestInput: HistoricalDatasetBuildRequest): Promise<HistoricalDatasetBuildResult> {
    const request = historicalDatasetBuildRequestSchema.parse(requestInput);
    const env = this.input.env ?? process.env;
    verifyOandaPracticeEnvironment(env);
    const client = this.input.client ?? new OandaPracticeHistoricalClient(env, this.input.fetchImpl);
    const available = new Set(await client.listInstruments());
    const output = request.outputDirectory;
    if (existsSync(output) && !request.resume) throw new Error("output directory exists; use --resume or a new output directory");
    mkdirSync(output, { recursive: true });
    const checkpointPath = join(output, "acquisition-checkpoint.json");
    const windowsDirectory = join(output, ".acquisition", "windows");
    mkdirSync(windowsDirectory, { recursive: true });
    const configHash = hashRequest(request);
    const checkpoint = request.resume && existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : null;
    if (checkpoint && (checkpoint.schemaVersion !== "fincoach.v2.oanda-dataset-checkpoint.1" || checkpoint.configHash !== configHash)) throw new Error("checkpoint does not match requested dataset build configuration");
    const completedWindows = new Set<string>(checkpoint?.completedWindows ?? []);
    const datasetId = request.datasetId ?? `oanda-${request.symbols.join("-").toLowerCase()}-${request.startTime.slice(0, 10)}-${request.endTime.slice(0, 10)}`;
    const datasetVersion = request.datasetVersion ?? "1";
    const windowFiles: Array<{ order: string; path: string }> = [];
    let rejectedRecords = 0;
    let requestsCompleted = checkpoint?.requestsCompleted ?? 0;
    const requestIdLog: string[] = [];
    for (const rawSymbol of request.symbols) {
      const symbol = this.marketData.normalizeSymbol(rawSymbol);
      const providerSymbol = symbol.providerSymbols.oanda_practice ?? symbol.symbol;
      if (available.size > 0 && !available.has(providerSymbol)) throw new Error(`Unsupported OANDA practice instrument: ${providerSymbol}`);
      for (const timeframe of request.timeframes) {
        const granularity = oandaGranularity(timeframe);
        for (const window of buildWindows(request.startTime, request.endTime, timeframe, request.maxCandlesPerRequest)) {
          const windowKey = `${providerSymbol}:${timeframe}:${window.from}:${window.to}`;
          const windowFile = join(windowsDirectory, `${hashString(windowKey)}.jsonl`);
          windowFiles.push({ order: windowKey, path: windowFile });
          if (completedWindows.has(windowKey) && existsSync(windowFile)) continue;
          const page = await fetchWithRetry(client, { instrument: providerSymbol, granularity, from: window.from, to: window.to, price: oandaPriceParameter(request.priceComponent), count: request.maxCandlesPerRequest }, request.maxRetries);
          if (page.requestId) requestIdLog.push(page.requestId);
          const records = page.candles.flatMap((raw, index) => {
            try {
              if (raw.complete === false && !request.allowIncompleteFinalCandle) return [];
              const candle = normalizeOandaCandle(this.marketData, raw, symbol.symbol, providerSymbol, timeframe, request.priceComponent, index);
              return [toHistoricalRecord(candle, providerSymbol, request.priceComponent)];
            } catch {
              rejectedRecords += 1;
              return [];
            }
          });
          writeWindowFile(windowFile, records.sort(compareHistoricalRecords));
          requestsCompleted += 1;
          completedWindows.add(windowKey);
          writeFileSync(checkpointPath, `${JSON.stringify({ schemaVersion: "fincoach.v2.oanda-dataset-checkpoint.1", configHash, datasetId, datasetVersion, completedWindows: [...completedWindows].sort(), requestsCompleted, updatedAt: now(this.input).toISOString() }, null, 2)}\n`);
          await waitForRateLimit(request.rateLimitMs);
        }
      }
    }
    const assembly = await assemblePartitions(output, windowFiles, request.partitionPolicy.strategy, request.partitionPolicy.compression);
    const duplicatesSuppressed = assembly.duplicatesSuppressed;
    rejectedRecords += assembly.rejectedRecords;
    if (!assembly.partitionMetadata.length) throw new Error("OANDA dataset acquisition produced no complete candles");
    const manifest: HistoricalReplayDatasetManifest = {
      schemaVersion: "fincoach.v2.historical-replay-dataset.1",
      datasetId,
      datasetVersion,
      createdAt: now(this.input).toISOString(),
      sourceDescription: `OANDA practice historical candles via ${BUILDER_VERSION}; price=${request.priceComponent}; requestHash=${configHash}; requestIds=${requestIdLog.length}`,
      assetClasses: ["forex", "metal"],
      symbols: request.symbols.map(symbol => this.marketData.normalizeSymbol(symbol).symbol).sort(),
      timeframes: [...request.timeframes].sort(),
      earliestTimestamp: assembly.earliest,
      latestTimestamp: assembly.latest,
      publicationTimePolicy: "oanda_candle_time_as_available_after_close",
      revisionPolicy: "immutable_source_record_no_revisions",
      corporateActionPolicy: "not_applicable_fx_metals",
      timezonePolicy: "utc",
      partitions: assembly.partitionMetadata,
      totalRecordCount: assembly.totalRecordCount,
      contentHashAlgorithm: "sha256",
    };
    const manifestHash = hashHistoricalDatasetManifest(manifest);
    writeFileSync(join(output, "manifest.json"), `${JSON.stringify({ ...manifest, manifestHash }, null, 2)}\n`);
    writeFileSync(join(output, "manifest.sha256"), `${manifestHash}\n`);
    writeFileSync(join(output, "acquisition-summary.json"), `${JSON.stringify({ provider: "oanda", environment: "practice", request: { ...request, outputDirectory: "[redacted-path]" }, requestHash: configHash, duplicatesSuppressed, rejectedRecords, requestsCompleted, builderVersion: BUILDER_VERSION }, null, 2)}\n`);
    const validation = await validateHistoricalDataset({ manifest: { ...manifest, manifestHash }, manifestHash, rootDirectory: output });
    writeFileSync(join(output, "dataset-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
    return { datasetId, datasetVersion, manifestPath: join(output, "manifest.json"), manifestHash, symbols: manifest.symbols, timeframes: manifest.timeframes, requestedRange: { startTime: request.startTime, endTime: request.endTime }, actualRange: { startTime: assembly.earliest, endTime: assembly.latest }, candleCount: assembly.totalRecordCount, partitionCount: assembly.partitionMetadata.length, gaps: assembly.gapCount, duplicatesSuppressed, rejectedRecords, resumed: Boolean(checkpoint), validationStatus: validation.ok ? (assembly.gapCount ? "passed_with_warnings" : "passed") : "failed" };
  }
}

async function fetchWithRetry(client: OandaHistoricalClient, input: Parameters<OandaHistoricalClient["fetchCandles"]>[0], maxRetries: number) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const page = await client.fetchCandles(input);
    if (page.retryAfterMs != null) {
      if (attempt === maxRetries) throw new Error("OANDA rate limit retry budget exhausted");
      await waitForRateLimit(page.retryAfterMs);
      continue;
    }
    return page;
  }
  throw new Error("OANDA retry budget exhausted");
}

function normalizeOandaCandle(service: MarketDataV2Service, raw: OandaRawCandle, symbol: string, providerSymbol: string, timeframe: V2Timeframe, price: "mid" | "bid" | "ask" | "bid_ask", sequence: number) {
  const basis = price === "ask" ? raw.ask : price === "bid" ? raw.bid : raw.mid ?? midpoint(raw.bid, raw.ask);
  if (!basis) throw new Error("OANDA candle missing requested price component");
  return service.normalizeCandle({ symbol, timeframe, timestamp: raw.time, open: n(basis.o), high: n(basis.h), low: n(basis.l), close: n(basis.c), bid: raw.bid && { open: n(raw.bid.o), high: n(raw.bid.h), low: n(raw.bid.l), close: n(raw.bid.c) }, ask: raw.ask && { open: n(raw.ask.o), high: n(raw.ask.h), low: n(raw.ask.l), close: n(raw.ask.c) }, volume: raw.volume ?? null, tickVolume: raw.volume ?? null, complete: raw.complete !== false, provider: "oanda_practice", providerSymbol, adapterVersion: BUILDER_VERSION });
}

function toHistoricalRecord(candle: NormalizedCandle, providerSymbol: string, priceComponent: string): HistoricalReplayRecord {
  return { schemaVersion: "fincoach.v2.historical-record.1", recordId: `oanda:${providerSymbol}:${candle.timeframe}:${candle.timestamp}`, recordType: "candle", sourceId: "oanda_practice", sourceSequence: `${providerSymbol}:${candle.timeframe}:${candle.timestamp}`, eventTime: candle.timestamp, effectiveTime: candle.timestamp, publicationTime: candle.timestamp, symbol: candle.symbol, timeframe: candle.timeframe, payload: { candle, priceComponent, providerSymbol } };
}

function writeWindowFile(path: string, records: HistoricalReplayRecord[]) {
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmpPath, records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
  renameSync(tmpPath, path);
}

async function assemblePartitions(output: string, windowFiles: Array<{ order: string; path: string }>, strategy: string, compression: "none" | "gzip") {
  const assemblyDirectory = join(output, ".acquisition", "assembly");
  rmSync(assemblyDirectory, { recursive: true, force: true });
  mkdirSync(assemblyDirectory, { recursive: true });
  const states = new Map<string, { partitionId: string; safe: string; tempPath: string; symbol: string; timeframe: string; startTimestamp: string; endTimestamp: string; recordCount: number; previousTimestamp: string | null; gapCount: number }>();
  const seen = new Map<string, string>();
  let duplicatesSuppressed = 0;
  let rejectedRecords = 0;
  let earliest = "";
  let latest = "";
  for (const window of windowFiles.sort((a, b) => a.order.localeCompare(b.order))) {
    if (!existsSync(window.path)) throw new Error(`missing committed OANDA acquisition window: ${window.order}`);
    const lines = readFileSync(window.path, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as HistoricalReplayRecord;
        const fingerprint = createHash("sha256").update(JSON.stringify(record.payload)).digest("hex");
        const duplicate = seen.get(record.recordId);
        if (duplicate) {
          if (duplicate !== fingerprint) throw new Error(`conflicting duplicate candle ${record.recordId}`);
          duplicatesSuppressed += 1;
          continue;
        }
        seen.set(record.recordId, fingerprint);
        const partitionId = partitionIdFor(record.symbol!, record.timeframe!, strategy, record.publicationTime);
        const safe = partitionId.replace(/[^A-Za-z0-9_.=-]/g, "_");
        const state = states.get(partitionId) ?? { partitionId, safe, tempPath: join(assemblyDirectory, `${safe}.jsonl`), symbol: record.symbol!, timeframe: record.timeframe!, startTimestamp: record.publicationTime, endTimestamp: record.publicationTime, recordCount: 0, previousTimestamp: null, gapCount: 0 };
        if (state.previousTimestamp) {
          const expected = timeframeMs(record.timeframe as V2Timeframe);
          if (Date.parse(record.publicationTime) - Date.parse(state.previousTimestamp) > expected * 1.5 && !isWeekendGap(state.previousTimestamp, record.publicationTime)) state.gapCount += 1;
        }
        state.previousTimestamp = record.publicationTime;
        state.endTimestamp = record.publicationTime;
        state.recordCount += 1;
        appendFileSync(state.tempPath, `${JSON.stringify(record)}\n`);
        states.set(partitionId, state);
        earliest = earliest ? (record.publicationTime < earliest ? record.publicationTime : earliest) : record.publicationTime;
        latest = latest ? (record.publicationTime > latest ? record.publicationTime : latest) : record.publicationTime;
      } catch (error) {
        if (error instanceof Error && /conflicting duplicate/.test(error.message)) throw error;
        rejectedRecords += 1;
      }
    }
  }
  const partitionMetadata: HistoricalReplayPartition[] = [];
  for (const state of [...states.values()].sort((a, b) => a.partitionId.localeCompare(b.partitionId))) {
    const relativePath = `${state.safe}.jsonl${compression === "gzip" ? ".gz" : ""}`;
    const finalPath = join(output, relativePath);
    const tmpPath = `${finalPath}.tmp-${randomUUID()}`;
    mkdirSync(dirname(finalPath), { recursive: true });
    if (compression === "gzip") {
      await pipeline(createReadStream(state.tempPath), createGzip(), createWriteStream(tmpPath));
      rmSync(state.tempPath, { force: true });
    } else {
      renameSync(state.tempPath, tmpPath);
    }
    renameSync(tmpPath, finalPath);
    partitionMetadata.push({ partitionId: state.partitionId, relativePath, format: "jsonl", compression, symbol: state.symbol, timeframe: state.timeframe, startTimestamp: state.startTimestamp, endTimestamp: state.endTimestamp, recordCount: state.recordCount, contentHash: await hashFile(finalPath), byteSize: statSync(finalPath).size });
  }
  return { partitionMetadata, totalRecordCount: partitionMetadata.reduce((sum, partition) => sum + partition.recordCount, 0), earliest, latest, duplicatesSuppressed, rejectedRecords, gapCount: [...states.values()].reduce((sum, state) => sum + state.gapCount, 0) };
}

function buildWindows(start: string, end: string, timeframe: V2Timeframe, maxCandles: number) {
  const step = timeframeMs(timeframe) * maxCandles;
  const windows: Array<{ from: string; to: string }> = [];
  for (let cursor = Date.parse(start); cursor < Date.parse(end); cursor += step) windows.push({ from: new Date(cursor).toISOString(), to: new Date(Math.min(cursor + step, Date.parse(end))).toISOString() });
  return windows;
}

function partitionIdFor(symbol: string, timeframe: string, strategy: string, timestamp: string) {
  return strategy === "monthly" ? `${symbol}-${timeframe}-${timestamp.slice(0, 7)}` : `${symbol}-${timeframe}`;
}

function compareHistoricalRecords(a: HistoricalReplayRecord, b: HistoricalReplayRecord) {
  return `${a.publicationTime}|${a.effectiveTime}|${a.sourceSequence}|${a.recordId}`.localeCompare(`${b.publicationTime}|${b.effectiveTime}|${b.sourceSequence}|${b.recordId}`);
}

function midpoint(bid?: { o: string; h: string; l: string; c: string }, ask?: { o: string; h: string; l: string; c: string }) {
  if (!bid || !ask) return undefined;
  return { o: String((n(bid.o) + n(ask.o)) / 2), h: String((n(bid.h) + n(ask.h)) / 2), l: String((n(bid.l) + n(ask.l)) / 2), c: String((n(bid.c) + n(ask.c)) / 2) };
}
function n(value: string) { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error("non-finite OANDA price"); return parsed; }
function hashRequest(request: HistoricalDatasetBuildRequest) { return createHash("sha256").update(JSON.stringify({ ...request, outputDirectory: undefined, resume: undefined })).digest("hex"); }
function hashString(value: string) { return createHash("sha256").update(value).digest("hex"); }
function now(input: { now?: () => Date }) { return input.now?.() ?? new Date(); }
function timeframeMs(timeframe: V2Timeframe) { return ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000, "1mo": 2_592_000_000 })[timeframe]; }
function isWeekendGap(left: string, right: string) { const l = new Date(left).getUTCDay(); const r = new Date(right).getUTCDay(); return l === 5 && (r === 0 || r === 1); }
