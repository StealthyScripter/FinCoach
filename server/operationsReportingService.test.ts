import assert from "node:assert/strict";
import { OperationsReportingService } from "./operationsReportingService";

const rows = {
  observations: 4,
  hypotheses: 2,
  strategies: 1,
  experiments: 1,
  backtests: 1,
  verdicts: 1,
  rankings: 1,
  forwardTests: 0,
  signals: 0,
  evaluations: 3,
  journal: 0,
  lessons: 0,
  lifecycle: 0,
  detectorEvaluations: 3,
};

const dbQueries: Array<{ sql: string; values?: unknown[] }> = [];
const db = {
  async query(sql: string, values?: unknown[]) {
    dbQueries.push({ sql, values });
    if (sql.includes("FROM execution_audit_entries")) return {
      rows: [
        { detail: { realizedPnL: 12 } },
        { detail: { realizedPnL: -5 } },
        { detail: { realizedPnL: 0 } },
      ],
    };
    if (sql.includes("FROM v2_orchestration_cycles")) return { rows: [{ status: "completed", count: 2 }, { status: "failed", count: 1 }] };
    if (sql.includes("FROM v2_market_observations GROUP BY symbol")) return {
      rows: [
        { symbol: "EUR_USD", timeframe: "M5", detector_id: "breakout", strategy_family: "breakout", count: 3 },
        { symbol: "GBP_USD", timeframe: "M15", detector_id: "trend", strategy_family: "trend", count: 1 },
      ],
    };
    if (sql.includes("FROM v2_detector_evaluations GROUP BY detector_id")) return {
      rows: [
        { detector_id: "breakout", symbol: "EUR_USD", timeframe: "M5", total: 2, completed: 1, duplicate_suppressed: 1, failed: 0 },
        { detector_id: "trend", symbol: "GBP_USD", timeframe: "M15", total: 1, completed: 1, duplicate_suppressed: 0, failed: 0 },
      ],
    };
    if (sql.includes("SELECT payload, created_at FROM v2_strategy_definitions")) return {
      rows: [{ payload: { strategyId: "s1", symbols: ["EUR_USD"], timeframes: ["M5"], filters: { primaryFamily: "breakout" }, session: "new-york" }, created_at: "2026-08-13T13:00:00.000Z" }],
    };
    if (sql.includes("SELECT payload, created_at FROM v2_ranking_decisions")) return {
      rows: [{ payload: { strategyId: "s1", rank: 1, symbol: "EUR_USD", session: "new-york", family: "breakout", score: 0.82, tradeCount: 12, winRate: 0.58, profitFactor: 1.7, expectancy: 0.2, maxDrawdown: 0.08, status: "ranked" }, created_at: "2026-08-13T13:00:00.000Z" }],
    };
    return { rows: [rows] };
  },
};

const brokerRequests: string[] = [];
const fakeBrokerHttp = async (url: string) => {
  brokerRequests.push(url);
  if (url.includes("/transactions")) return {
    ok: true,
    status: 200,
    async json() {
      return {
        transactions: [
          { type: "ORDER_FILL", pl: "30", financing: "-0.5", commission: "0" },
          { type: "ORDER_FILL", pl: "-10", financing: "0", commission: "-0.2" },
        ],
      };
    },
  };
  if (url.includes("/openPositions")) return {
    ok: true,
    status: 200,
    async json() {
      return { positions: [{ unrealizedPL: "4.25" }, { unrealizedPL: "-1.25" }] };
    },
  };
  throw new Error(`unexpected broker URL ${url}`);
};

const service = new OperationsReportingService({
  FINCOACH_PRESENTATION_TIMEZONE: "America/New_York",
  FINCOACH_V2_RESEARCH_SYMBOLS: "EUR_USD,GBP_USD,USD_JPY",
  FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  FINCOACH_V2_FORWARD_TESTING_ENABLED: "false",
  FINCOACH_V2_RESEARCH_SIGNAL_ENABLED: "false",
  FINCOACH_V2_TELEGRAM_SIGNAL_PUBLICATION_ENABLED: "false",
  OANDA_ENV: "practice",
  OANDA_API_TOKEN: "test-token",
  OANDA_ACCOUNT_ID: "test-account",
  OANDA_BASE_URL: "https://api-fxpractice.oanda.com/v3",
} as NodeJS.ProcessEnv, db, fakeBrokerHttp);

const now = new Date("2026-08-13T13:00:00.000Z");
const snapshot = await service.snapshot(now);
const api = await service.apiView("status", now);
const status = await service.telegramMessage("/status", "", now);
const research = await service.telegramMessage("/research", "", now);
const trading = await service.telegramMessage("/trading", "", now);
const week = await service.telegramMessage("/week", "", now);
const why = await service.telegramMessage("/why", "signals", now);

assert.deepEqual(stableSnapshot(api.body), stableSnapshot(snapshot));
assert.equal(snapshot.databaseBacked, true);
assert.equal(snapshot.research.observations, 4);
assert.equal(snapshot.strategies.total, 1);
assert.equal(snapshot.pnl.paper.realizedPnl, 7);
assert.equal(snapshot.pnl.paper.tradeCount, 3);
assert.equal(snapshot.pnl.periods.weekly.paper.realizedPnl, 7);
assert.equal(snapshot.pnl.broker.realizedPnl, 20);
assert.equal(snapshot.pnl.broker.unrealizedPnl, 3);
assert.equal(snapshot.pnl.broker.brokerBacked, true);
assert.equal(snapshot.pnl.periods.daily.broker.source, "oanda-practice-transactions");
assert.ok(dbQueries.filter(query => query.sql.includes("FROM execution_audit_entries")).every(query => query.values?.[0] && query.values?.[1]));
assert.ok(brokerRequests.every(url => !/\/orders(?:\/|$)|\/trades\/[^?]+\/close|\/positions\/[^?]+\/close/i.test(url)));
assert.match(status, /Strategies: 1; Ranked: 1/);
assert.match(status, /Observations: 4/);
assert.match(research, /Cycles completed\/failed\/skipped: 2\/1\/0/);
assert.match(trading, /live blocked/);
assert.match(week, /Weekly/);
assert.match(week, /Broker source: oanda-practice-transactions/);
assert.match(why, /intentionally disabled/i);

console.log("operations reporting reconciliation tests passed");

function stableSnapshot(value: unknown) {
  const copy = structuredClone(value) as Record<string, unknown>;
  const runtime = copy.runtime as Record<string, unknown> | undefined;
  if (runtime) runtime.uptimeSeconds = 0;
  return copy;
}
