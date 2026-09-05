import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HistoricalDataImportService } from "./historicalDataImportService";
import {
  InMemoryTradeForensicsRepository,
  TradeForensicsService,
  TradeForensicsUnavailableError,
  openTradeForensicsUnavailable,
  relativeToWidthFraction,
} from "./execution/tradeForensicsService";

const enteredAt = new Date("2026-09-03T13:30:00.000Z");
const closedAt = new Date("2026-09-03T15:30:00.000Z");
const durationMs = closedAt.getTime() - enteredAt.getTime();

function serviceWithCandles(end = new Date(closedAt.getTime() + durationMs)) {
  const historical = new HistoricalDataImportService();
  seedCandles(historical, new Date(enteredAt.getTime() - durationMs), end);
  const repository = new InMemoryTradeForensicsRepository();
  return { service: new TradeForensicsService(repository, historical), repository };
}

function seedCandles(historical: HistoricalDataImportService, start: Date, end: Date) {
  const candles = [];
  for (let cursor = start.getTime(), index = 0; cursor <= end.getTime(); cursor += 60_000, index += 1) {
    const price = 1.1 + Math.sin(index / 12) * 0.001 + index * 0.000002;
    candles.push({
      instrument: "EUR_USD",
      timeframe: "1m" as const,
      timestamp: new Date(cursor).toISOString(),
      open: price,
      high: price + 0.0001,
      low: price - 0.0001,
      close: Number(price.toFixed(6)),
      volume: 100 + index,
      spread: 0.00012,
    });
  }
  historical.importCandles({ candles, source: "provider", now: new Date("2026-09-03T16:00:00.000Z") });
}

async function baseRecord(overrides: Record<string, unknown> = {}) {
  const { service } = serviceWithCandles();
  return service.generate({
    tradeId: "trade-1",
    symbol: "EUR_USD",
    side: "long",
    positionSize: 100000,
    enteredAt: enteredAt.toISOString(),
    closedAt: closedAt.toISOString(),
    entryPrice: 1.1,
    closingPrice: 1.106,
    takeProfitPrice: 1.107,
    stopLossPrice: 1.095,
    trailingStopPrice: 1.103,
    grossPnl: 610,
    netPnl: 600,
    netPnlPercent: 0.545,
    closeReason: "BROKER_CLOSE",
    source: "broker-reconciliation",
    authoritativePnlSource: "broker_reconciliation",
    ...overrides,
  });
}

const record = await baseRecord();
assert.equal(record.durationMs, durationMs);
assert.equal(record.requestedWindow.beforeStart, new Date(enteredAt.getTime() - durationMs).toISOString());
assert.equal(record.requestedWindow.entry, enteredAt.toISOString());
assert.equal(record.requestedWindow.exit, closedAt.toISOString());
assert.equal(record.requestedWindow.afterEnd, new Date(closedAt.getTime() + durationMs).toISOString());
assert.deepEqual(record.xDomain, { min: -durationMs, entry: 0, exit: durationMs, max: durationMs * 2 });
assert.deepEqual(record.chartSections.map((section) => section.widthFraction), [1 / 3, 1 / 3, 1 / 3]);
assert.equal(relativeToWidthFraction(-durationMs, durationMs), 0);
assert.equal(relativeToWidthFraction(0, durationMs), 1 / 3);
assert.equal(relativeToWidthFraction(durationMs, durationMs), 2 / 3);
assert.equal(relativeToWidthFraction(durationMs * 2, durationMs), 1);
assert.deepEqual(record.entryMarker, { timestamp: enteredAt.toISOString(), relativeMs: 0, marketPrice: 1.1, normalizedPrice: 0, normalizedPercent: 0 });
assert.equal(record.exitMarker.relativeMs, durationMs);
const historicalEntryPoint = record.points.find((point) => point.relativeMs === 0);
assert.ok(historicalEntryPoint);
assert.notEqual(historicalEntryPoint.marketPrice, record.entryMarker.marketPrice);
assert.notEqual(historicalEntryPoint.normalizedPrice, 0);
assert.ok(record.points.some((point) => point.relativeMs === durationMs));
assert.equal(record.mainLineColor, "green");
assert.equal(record.result, "profit");
assert.deepEqual(record.referenceLines.map((line) => line.kind), ["take_profit", "stop_loss", "trailing_stop", "close"]);
assert.equal(record.closingPrice, 1.106);
assert.equal(record.netPnl, 600);
assert.equal(record.grossPnl, 610);
assert.equal(record.authoritativePnlSource, "broker_reconciliation");

const zero = await baseRecord({ tradeId: "trade-zero", netPnl: 0 });
assert.equal(zero.mainLineColor, "red");
assert.equal(zero.result, "non_profit");
const loss = await baseRecord({ tradeId: "trade-loss", netPnl: -10 });
assert.equal(loss.mainLineColor, "red");

const sparseLines = await baseRecord({ tradeId: "trade-lines", takeProfitPrice: null, stopLossPrice: undefined, trailingStopPrice: null });
assert.deepEqual(sparseLines.referenceLines.map((line) => line.kind), ["close"]);

const short = await baseRecord({ tradeId: "trade-short", side: "short", entryPrice: 1.1, closingPrice: 1.095, netPnl: 500 });
assert.equal(short.entryMarker.normalizedPrice, 0);
assert.equal(short.side, "short");

const duplicateContext = serviceWithCandles();
const first = await duplicateContext.service.generate({ ...(record as any), id: undefined, tradeId: "dup-trade" });
const second = await duplicateContext.service.generate({ ...(record as any), id: undefined, tradeId: "dup-trade" });
assert.equal(first.id, second.id);
assert.equal((await duplicateContext.repository.list()).length, 1);

await assert.rejects(
  () => baseRecord({ tradeId: "invalid-duration", closedAt: enteredAt.toISOString() }),
  (error) => error instanceof TradeForensicsUnavailableError && error.code === "invalid_duration" && error.status === 422,
);

const noData = new TradeForensicsService(new InMemoryTradeForensicsRepository(), new HistoricalDataImportService());
await assert.rejects(
  () => noData.generate({ ...(record as any), tradeId: "missing-data" }),
  (error) => error instanceof TradeForensicsUnavailableError && error.code === "missing_historical_data" && error.status === 422,
);

assert.throws(
  () => openTradeForensicsUnavailable({
    id: "open-trade",
    strategyId: "s",
    symbol: "EUR_USD",
    side: "buy",
    units: 1,
    entryPrice: 1.1,
    currentPrice: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    trailingStopDistance: null,
    highestPrice: 1.1,
    lowestPrice: 1.1,
    unrealizedPnL: 0,
    openedAt: enteredAt.toISOString(),
    lifecycleId: "lifecycle",
    thesis: "test",
    entryReason: "test",
    expectedMove: "test",
    riskTaken: 0.01,
  }),
  (error) => error instanceof TradeForensicsUnavailableError && error.code === "open_trade" && error.status === 409,
);

const friday = new Date("2026-09-04T21:30:00.000Z");
const fridayHistorical = new HistoricalDataImportService();
seedCandles(fridayHistorical, new Date("2026-09-04T17:30:00.000Z"), new Date("2026-09-04T22:00:00.000Z"));
const fridayContext = { service: new TradeForensicsService(new InMemoryTradeForensicsRepository(), fridayHistorical) };
const fridayRecord = await fridayContext.service.generate({
  tradeId: "friday-trade",
  symbol: "EUR_USD",
  side: "long",
  enteredAt: new Date(friday.getTime() - 2 * 60 * 60_000).toISOString(),
  closedAt: friday.toISOString(),
  entryPrice: 1.1,
  closingPrice: 1.101,
  netPnl: 100,
  source: "broker-reconciliation",
  authoritativePnlSource: "broker_reconciliation",
});
assert.equal(fridayRecord.actualWindow.afterTruncated, true);
assert.equal(fridayRecord.actualWindow.truncationReason, "friday_close");

const ui = readFileSync(new URL("../client/src/pages/execution-center.tsx", import.meta.url), "utf8");
assert.match(ui, /postTradeReviews\.slice\(0, 5\)\.map/);
assert.match(ui, /review\.tradeId &&/);
assert.match(ui, /View Forensics/);
assert.doesNotMatch(ui, /openPaperPositions[\s\S]{0,800}View Forensics/);
assert.match(ui, /api\/marketpilot\/trades\/\$\{tradeId\}\/forensics/);

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
assert.match(routes, /app\.use\("\/api", requireAuthenticatedRequest\)/);
assert.match(routes, /\/api\/marketpilot\/trades\/:tradeId\/forensics/);

const files = [
  readFileSync(new URL("./execution/tradeForensicsService.ts", import.meta.url), "utf8"),
].join("\n");
assert.doesNotMatch(files, /api-fxtrade\.oanda\.com/);
assert.doesNotMatch(files, /\/orders\b|submitSandboxOrder|closePosition|\/close\b/);

console.log("tradeForensicsService tests passed");
