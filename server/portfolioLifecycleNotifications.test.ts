import assert from "node:assert/strict";
import { calculateFeatures, crossAssetFeatures } from "./portfolio/features";
import { lifecycleDecision, lifecycleEvent, mutateStrategy } from "./portfolio/lifecycle";
import { performanceAttribution } from "./portfolio/attribution";
import { PortfolioNotificationService } from "./portfolio/notifications";
import { instantiateSeedStrategies } from "./portfolio/strategies";
import { returnsFromBars } from "./portfolio/analytics";
import type { PortfolioHistoricalBar } from "./portfolio/domain";

const bars = makeBars("SPY", Array.from({ length: 80 }, (_, index) => 100 + index * 0.5 + Math.sin(index)));
const features = calculateFeatures("SPY", bars);
assert.equal(features.symbol, "SPY");
assert.ok(features.rollingReturn20d !== null);
assert.ok(features.momentum60d !== null);
assert.equal(features.provenance.source, "fixture");

const bonds = makeBars("AGG", Array.from({ length: 80 }, (_, index) => 100 + index * 0.05));
const cross = crossAssetFeatures([returnsFromBars("SPY", bars), returnsFromBars("AGG", bonds)]);
assert.equal(cross.correlation.length, 2);

const strategy = instantiateSeedStrategies(100_000)[0];
const child = mutateStrategy(strategy, { suffix: "A", now: new Date("2026-08-14T15:00:00.000Z") });
assert.equal(child.parentStrategyId, strategy.id);
assert.equal(child.lifecycleState, "RESEARCH");
assert.ok(child.strategyVersion > strategy.strategyVersion);

const mature = lifecycleDecision({ strategy, backtestPassed: true, walkForwardPassed: true, forwardDays: 30, drawdownPct: 2 });
assert.equal(mature.stage, "MATURE");
const candidate = lifecycleDecision({ strategy, backtestPassed: true, walkForwardPassed: true, forwardDays: 90, drawdownPct: 2 });
assert.equal(candidate.stage, "LIVE_CANDIDATE");
assert.equal(candidate.liveExecutionBlocked, true);
const event = lifecycleEvent({ strategy, stage: candidate.stage, reason: candidate.reason });
assert.equal(event.eventType, "LIVE_CANDIDATE");
assert.equal(event.evidence.liveExecutionBlocked, true);

const attribution = performanceAttribution({
  positions: [{ id: "p", portfolioId: "portfolio", symbol: "SPY", assetClass: "etf", quantity: 10, averageCost: 100, currentPrice: 105, currency: "USD", updatedAt: new Date().toISOString() }],
  transactions: [{ id: "tx", portfolioId: "portfolio", idempotencyKey: "tx", side: "BUY", symbol: "SPY", assetClass: "etf", quantity: 10, price: 100, fee: 1, realizedPnl: 0, reason: "test", evidence: {}, executedAt: new Date().toISOString() }],
});
assert.equal(attribution.byPosition[0].pnl, 50);
assert.equal(attribution.costDrag, 1);

const messages: string[] = [];
const notifications = new PortfolioNotificationService({ sendOperations: async (_kind, text) => { messages.push(text); return { sent: true as const }; } }, 60_000);
const sent = await notifications.rebalance({ strategy: "MAXSHARPE", nav: 103421.18, riskLevel: 7, reason: "Correlation and volatility drift exceeded rebalance threshold.", changes: ["AAPL 14.2% → 10.0%"], expectedVolatilityBefore: 14.8, expectedVolatilityAfter: 12.6 });
assert.equal(sent.sent, true);
const duplicate = await notifications.rebalance({ strategy: "MAXSHARPE", nav: 103421.18, riskLevel: 7, reason: "Correlation and volatility drift exceeded rebalance threshold.", changes: ["AAPL 14.2% → 10.0%"], expectedVolatilityBefore: 14.8, expectedVolatilityAfter: 12.6 });
assert.equal(duplicate.sent, false);
assert.match(messages[0], /No real broker order submitted/);
await notifications.limitReached({ code: "max_strategies", configKey: "FINCOACH_PORTFOLIO_MAX_ACTIVE_STRATEGIES", configured: 40, observed: 40, action: "New strategy creation deferred." });
await notifications.lifecycle({ strategy: "MAXSHARPE", stage: "LIVE_CANDIDATE", reason: "Evidence supports operator review." });
assert.ok(messages.some((message) => /LIVE_CANDIDATE/.test(message)));

function makeBars(symbol: string, closes: number[]): PortfolioHistoricalBar[] {
  return closes.map((close, index) => ({ symbol, assetClass: "etf", open: close, high: close, low: close, close, adjustedClose: close, volume: 1000 + index * 10, dividendAmount: 0, splitCoefficient: 1, observedAt: new Date(Date.UTC(2026, 0, index + 1, 21)).toISOString(), source: "fixture", fixture: true }));
}
