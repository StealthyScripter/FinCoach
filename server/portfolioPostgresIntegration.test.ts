import assert from "node:assert/strict";
import { Pool } from "pg";
import { OperationalBlockerService } from "./operationalBlockerService";
import { PgPortfolioMarketDataCache, PortfolioMarketDataRouter, type PortfolioMarketDataProvider } from "./portfolio/marketData";
import type { AssetClass, PortfolioHistoricalBar, PortfolioQuote } from "./portfolio/domain";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.log("portfolio PostgreSQL integration tests skipped: TEST_DATABASE_URL is not set");
  process.exit(0);
}

class PgCountingProvider implements PortfolioMarketDataProvider {
  quoteCalls = 0;
  barCalls = 0;
  constructor(readonly id: string) {}
  capabilities() {
    return { assetClasses: ["equity", "etf"] as AssetClass[], capabilities: ["QUOTE", "HISTORICAL_OHLCV"] as const, fixture: false, live: true, historical: true, latestQuote: true, search: false, marketStatus: false, options: false };
  }
  async getQuote(symbol: string, assetClass: AssetClass, now = new Date()): Promise<PortfolioQuote> {
    this.quoteCalls += 1;
    return { symbol: symbol.toUpperCase(), assetClass, bid: null, ask: null, last: 100, currency: "USD", observedAt: now.toISOString(), stale: false, source: this.id, fixture: false };
  }
  async getHistoricalBars(symbol: string, assetClass: AssetClass, input = {} as { now?: Date }): Promise<PortfolioHistoricalBar[]> {
    this.barCalls += 1;
    const now = input.now ?? new Date();
    return [
      { symbol: symbol.toUpperCase(), assetClass, open: 100, high: 101, low: 99, close: 100, adjustedClose: 100, volume: 12345, dividendAmount: 0, splitCoefficient: 1, observedAt: now.toISOString(), source: this.id, fixture: false },
    ];
  }
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query("DELETE FROM portfolio_market_data_cache WHERE cache_key LIKE 'portfolio-md|pg-%'");
  await pool.query("DELETE FROM operational_blockers WHERE reason = 'pg integration verdict'");

  const durable = new PgPortfolioMarketDataCache(databaseUrl, pool);
  const writerProvider = new PgCountingProvider("pg-provider");
  const writer = new PortfolioMarketDataRouter([writerProvider], { cacheEnabled: true, cacheMaxEntries: 10, cacheMaxBytes: 1_000_000, cacheExpiredRetentionMs: 1_000 }, false, durable);
  const first = await writer.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:00.000Z") });
  assert.equal(writerProvider.barCalls, 1);
  assert.equal(first[0].marketData?.provider, "pg-provider");

  const stored = await pool.query("SELECT cache_key, payload::text AS payload FROM portfolio_market_data_cache WHERE cache_key LIKE 'portfolio-md|pg-provider|time_series|spy|%'");
  assert.equal(stored.rowCount, 1);
  assert.ok(!String(stored.rows[0].cache_key).includes("secret"));
  assert.ok(!String(stored.rows[0].payload).includes("secret"));

  const readerProvider = new PgCountingProvider("pg-provider");
  const reader = new PortfolioMarketDataRouter([readerProvider], { cacheEnabled: true, cacheMaxEntries: 10, cacheMaxBytes: 1_000_000, cacheExpiredRetentionMs: 1_000 }, false, durable);
  const cached = await reader.getHistoricalBars("SPY", "etf", { interval: "1day", outputSize: "full", endDate: "2026-08-14", now: new Date("2026-08-17T15:00:05.000Z") });
  assert.equal(readerProvider.barCalls, 0, "durable L2 data should survive a new router instance");
  assert.equal(cached[0].marketData?.cacheStatus, "hit");
  assert.equal(cached[0].marketData?.freshnessState, "fresh");

  await pool.query(
    `INSERT INTO portfolio_market_data_cache
     (cache_key, provider, endpoint, symbol, interval, fetched_at, expires_at, stale_until, payload, payload_bytes)
     VALUES
     ('portfolio-md|pg-expired|time_series|old|etf|1day|*|utc|adjusted|compact|*|*|*|*|*|*', 'pg-expired', 'time_series', 'OLD', '1day', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days', '[]'::jsonb, 2),
     ('portfolio-md|pg-valid|time_series|new|etf|1day|*|utc|adjusted|compact|*|*|*|*|*|*', 'pg-valid', 'time_series', 'NEW', '1day', now(), now() + interval '1 hour', now() + interval '2 hours', '[]'::jsonb, 2)
     ON CONFLICT (cache_key) DO NOTHING`,
  );
  const pruned = await durable.pruneExpired({ olderThan: new Date(Date.now() - 86_400_000), limit: 10 });
  assert.ok(pruned >= 1, "expired durable cache rows should prune");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM portfolio_market_data_cache WHERE cache_key = 'portfolio-md|pg-expired|time_series|old|etf|1day|*|utc|adjusted|compact|*|*|*|*|*|*'")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM portfolio_market_data_cache WHERE cache_key = 'portfolio-md|pg-valid|time_series|new|etf|1day|*|utc|adjusted|compact|*|*|*|*|*|*'")).rows[0].count, 1);

  const blockerEnv = { DATABASE_URL: databaseUrl, TELEGRAM_NOTIFICATIONS_ENABLED: "false" } as NodeJS.ProcessEnv;
  const service = new OperationalBlockerService(blockerEnv);
  await service.record({
    kind: "lifecycle",
    code: "forward_test_candidate_rejected",
    title: "Forward-test candidate rejected",
    whatBlocked: "forward-test candidate",
    reason: "pg integration verdict",
    currentValue: "reject",
    limitValue: "approve_for_forward_test",
    scope: { cycleId: "cycle-pg-1", strategyId: "strategy-pg", component: "forward-testing" },
    expected: true,
    action: "Let evidence mature.",
    now: new Date("2026-08-14T21:00:00.000Z"),
  });
  await Promise.all(Array.from({ length: 5 }, (_, index) => service.record({
    kind: "lifecycle",
    code: "forward_test_candidate_rejected",
    title: "Forward-test candidate rejected",
    whatBlocked: "forward-test candidate",
    reason: "pg integration verdict",
    currentValue: "reject",
    limitValue: "approve_for_forward_test",
    scope: { cycleId: `cycle-pg-${index + 2}`, strategyId: "strategy-pg", component: "forward-testing" },
    expected: true,
    action: "Let evidence mature.",
    now: new Date(`2026-08-14T21:0${index + 1}:00.000Z`),
  })));
  const blockerRows = await pool.query("SELECT first_seen_at, last_seen_at, occurrence_count FROM operational_blockers WHERE code = 'forward_test_candidate_rejected' AND reason = 'pg integration verdict'");
  assert.equal(blockerRows.rowCount, 1);
  assert.equal(Number(blockerRows.rows[0].occurrence_count), 6);
  assert.equal(new Date(blockerRows.rows[0].first_seen_at).toISOString(), "2026-08-14T21:00:00.000Z");
  assert.equal(new Date(blockerRows.rows[0].last_seen_at).toISOString(), "2026-08-14T21:05:00.000Z");
  await (service as unknown as { pool?: Pool }).pool?.end();

  console.log("portfolio PostgreSQL integration tests passed");
} finally {
  await pool.query("DELETE FROM portfolio_market_data_cache WHERE cache_key LIKE 'portfolio-md|pg-%'").catch(() => undefined);
  await pool.query("DELETE FROM operational_blockers WHERE reason = 'pg integration verdict'").catch(() => undefined);
  await pool.end();
}
