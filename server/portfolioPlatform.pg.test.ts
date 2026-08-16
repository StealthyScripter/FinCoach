import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgPortfolioRepository } from "./portfolio/repository";
import type { PortfolioAccount, PortfolioDecisionEvent, PortfolioStrategy } from "./portfolio/domain";

if (!process.env.DATABASE_URL) {
  console.log("portfolio platform PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
  console.log("portfolio platform PostgreSQL tests skipped: DATABASE_URL is not an explicit local test database");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repository = new PgPortfolioRepository(process.env.DATABASE_URL, pool);
const suffix = `pg-${Date.now()}-${randomUUID().slice(0, 8)}`;
const strategyId = `strategy-${suffix}`;
const portfolioId = `portfolio-${suffix}`;
const now = new Date("2026-08-14T21:05:00.000Z").toISOString();

try {
  const strategy: PortfolioStrategy = {
    id: strategyId,
    shortName: `PG${suffix.slice(-6)}`.toUpperCase(),
    name: "PostgreSQL Portfolio Persistence",
    description: "Integration-test strategy for Portfolio persistence.",
    mandate: "balanced",
    riskLevel: 5,
    riskLabel: "Moderate",
    lifecycleState: "VIRTUAL_LIVE_DATA",
    strategyVersion: 1,
    parentStrategyId: null,
    researchHypothesis: "Durable Portfolio records survive repository reloads without live execution.",
    parameters: { fixture: true },
    benchmarkSymbol: "AOR",
    startingCapital: 12_345,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
  };
  const portfolio: PortfolioAccount = {
    id: portfolioId,
    strategyId,
    startingCapital: strategy.startingCapital,
    cash: strategy.startingCapital,
    currency: "USD",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await repository.saveStrategy(strategy);
  await repository.savePortfolio(portfolio);
  await repository.savePortfolio({ ...portfolio, cash: 10_000, updatedAt: new Date("2026-08-14T22:00:00.000Z").toISOString() });
  await repository.savePosition({ id: `position-${suffix}`, portfolioId, symbol: "AOR", assetClass: "etf", quantity: 10, averageCost: 57.2, currency: "USD", updatedAt: now });
  await repository.saveNav({ portfolioId, nav: 10_572, cash: 10_000, marketValue: 572, realizedPnl: 0, unrealizedPnl: 0, dailyPnl: 0, weeklyPnl: 0, source: "fixture", stale: false, observedAt: now, idempotencyKey: `nav-${suffix}` });
  await repository.saveNav({ portfolioId, nav: 10_572, cash: 10_000, marketValue: 572, realizedPnl: 0, unrealizedPnl: 0, dailyPnl: 0, weeklyPnl: 0, source: "fixture", stale: false, observedAt: now, idempotencyKey: `nav-${suffix}` });
  const event: PortfolioDecisionEvent = {
    id: `decision-${suffix}`,
    portfolioId,
    strategyId,
    eventType: "REBALANCE",
    symbol: "AOR",
    reason: "Integration test rebalance persistence.",
    beforeState: { cash: 12_345 },
    afterState: { cash: 10_000 },
    evidence: { source: "fixture" },
    expectedEffect: {},
    actualEffect: {},
    createdAt: now,
  };
  await repository.addDecision(event);
  await repository.addDecision(event);

  const reloaded = new PgPortfolioRepository(process.env.DATABASE_URL, pool);
  assert.equal((await reloaded.getStrategy(strategyId))?.startingCapital, 12_345);
  const savedPortfolio = await reloaded.getPortfolio(portfolioId);
  assert.ok(savedPortfolio);
  assert.equal(savedPortfolio.startingCapital, 12_345);
  assert.equal(savedPortfolio.cash, 10_000);
  assert.equal((await reloaded.listPositions(portfolioId)).length, 1);
  assert.equal((await reloaded.navHistory(portfolioId)).length, 1);
  assert.equal((await reloaded.listDecisions(portfolioId)).length, 1);
  console.log("portfolio platform PostgreSQL tests passed");
} finally {
  await pool.query("DELETE FROM portfolio_decision_journal WHERE id = $1", [`decision-${suffix}`]).catch(() => undefined);
  await pool.query("DELETE FROM portfolio_nav_history WHERE portfolio_id = $1", [portfolioId]).catch(() => undefined);
  await pool.query("DELETE FROM portfolios WHERE id = $1", [portfolioId]).catch(() => undefined);
  await pool.query("DELETE FROM portfolio_strategies WHERE id = $1", [strategyId]).catch(() => undefined);
  await pool.end();
}
