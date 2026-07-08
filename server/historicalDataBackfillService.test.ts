import assert from "node:assert/strict";
import { HistoricalDataImportService } from "./historicalDataImportService";
import { buildWindows, OandaHistoricalBackfillService } from "./historicalDataBackfillService";

const env = { OANDA_ENV: "practice", OANDA_API_TOKEN: "secret-token-never-print" } as NodeJS.ProcessEnv;

const windows = buildWindows({
  start: new Date("2025-01-01T00:00:00.000Z"),
  end: new Date("2025-01-01T05:00:00.000Z"),
  timeframe: "1h",
  maxCandlesPerRequest: 2,
});
assert.equal(windows.length, 3, "pagination windows should honor max candles per request");

const service = new HistoricalDataImportService();
const requested: string[] = [];
let rateLimitSeen = false;
const backfill = new OandaHistoricalBackfillService(service);
const dryRun = await backfill.backfillOanda({
  env,
  instruments: ["EUR/USD"],
  timeframes: ["1h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T05:00:00.000Z",
  maxCandlesPerRequest: 2,
  maxRequestsPerRun: 3,
  rateLimitMs: 0,
  dryRun: true,
  fetchImpl: async (url) => {
    requested.push(String(url));
    if (!rateLimitSeen) {
      rateLimitSeen = true;
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    }
    return candlesResponse(String(url), "EUR_USD", "1h");
  },
});
assert.equal(dryRun.requestsCompleted, 3);
assert.equal(dryRun.candlesFetched, 6);
assert.equal(dryRun.candlesImported, 0);
assert.equal(service.coverage("EUR/USD", "1h").candlesAvailable, 0, "dry-run must not write candles");
assert.ok(requested.every((url) => url.includes("EUR_USD") && url.includes("granularity=H1")));
assert.ok(!JSON.stringify(dryRun).includes(env.OANDA_API_TOKEN), "status must not expose token");

const imported = await backfill.backfillOanda({
  env,
  instruments: ["EUR/USD"],
  timeframes: ["1h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T05:00:00.000Z",
  maxCandlesPerRequest: 2,
  maxRequestsPerRun: 3,
  rateLimitMs: 0,
  dryRun: false,
  fetchImpl: async (url) => candlesResponse(String(url), "EUR_USD", "1h"),
});
assert.equal(imported.candlesImported, 6);
assert.equal(service.coverage("EUR/USD", "1h").candlesAvailable, 6);

const duplicate = await backfill.backfillOanda({
  env,
  instruments: ["EUR/USD"],
  timeframes: ["1h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T05:00:00.000Z",
  maxCandlesPerRequest: 2,
  maxRequestsPerRun: 3,
  rateLimitMs: 0,
  dryRun: false,
  resume: false,
  fetchImpl: async (url) => candlesResponse(String(url), "EUR_USD", "1h"),
});
assert.equal(duplicate.candlesImported, 0);
assert.equal(duplicate.duplicatesSkipped, 6);

const resumeRequests: string[] = [];
await backfill.backfillOanda({
  env,
  instruments: ["EUR/USD"],
  timeframes: ["1h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T08:00:00.000Z",
  maxCandlesPerRequest: 2,
  maxRequestsPerRun: 2,
  rateLimitMs: 0,
  resume: true,
  fetchImpl: async (url) => {
    resumeRequests.push(String(url));
    return candlesResponse(String(url), "EUR_USD", "1h");
  },
});
assert.ok(resumeRequests[0].includes(encodeURIComponent("2025-01-01T06:00:00.000Z")), "resume should start after latest imported candle");

const gapService = new HistoricalDataImportService();
const gapBackfill = new OandaHistoricalBackfillService(gapService);
const gap = await gapBackfill.backfillOanda({
  env,
  instruments: ["GBP/USD"],
  timeframes: ["1h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T04:00:00.000Z",
  maxCandlesPerRequest: 4,
  maxRequestsPerRun: 1,
  rateLimitMs: 0,
  fetchImpl: async () => new Response(JSON.stringify({
    candles: [
      oandaCandle("2025-01-01T00:00:00.000Z", 1.2),
      oandaCandle("2025-01-01T03:00:00.000Z", 1.203),
    ],
  })),
});
assert.equal(gap.candlesImported, 2);
assert.ok(gapService.coverage("GBP/USD", "1h").gaps.length >= 1, "gap reporting should use imported coverage");

const filterRequests: string[] = [];
await new OandaHistoricalBackfillService(new HistoricalDataImportService()).backfillOanda({
  env,
  instruments: ["XAU/USD"],
  timeframes: ["4h"],
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T04:00:00.000Z",
  maxRequestsPerRun: 1,
  rateLimitMs: 0,
  fetchImpl: async (url) => {
    filterRequests.push(String(url));
    return candlesResponse(String(url), "XAU_USD", "4h");
  },
});
assert.equal(filterRequests.length, 1);
assert.ok(filterRequests[0].includes("XAU_USD"));
assert.ok(filterRequests[0].includes("granularity=H4"));

const stopped = backfill.stop();
assert.equal(stopped.running, false);
assert.equal(stopped.stopRequested, true);
assert.ok(stopped.warnings.some((warning) => /stop requested/i.test(warning)));

const plan = backfill.acquisitionPlan(new Date("2026-01-01T00:00:00.000Z"));
assert.equal(plan.items.length, 20);
assert.ok(plan.items.some((item) => item.instrument === "EUR_USD" && item.timeframe === "1h" && item.candlesAvailable >= 6));
assert.ok(plan.items.every((item) => item.estimatedCandlesToMinimum >= 0));

console.log("historicalDataBackfillService tests passed");

function candlesResponse(url: string, instrument: string, timeframe: "1h" | "4h") {
  const parsed = new URL(url);
  const from = Date.parse(parsed.searchParams.get("from") ?? "");
  const step = timeframe === "4h" ? 4 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return new Response(JSON.stringify({
    candles: [
      oandaCandle(new Date(from).toISOString(), instrument === "XAU_USD" ? 2300 : 1.1),
      oandaCandle(new Date(from + step).toISOString(), instrument === "XAU_USD" ? 2301 : 1.101),
    ],
  }));
}

function oandaCandle(time: string, price: number) {
  return {
    complete: true,
    time,
    volume: 10,
    mid: {
      o: String(price),
      h: String(price + 0.001),
      l: String(price - 0.001),
      c: String(price + 0.0005),
    },
  };
}
