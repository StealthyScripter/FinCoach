import assert from "node:assert/strict";
import { EventLogService } from "./eventLogService";
import { ExecutionAuditLog } from "./execution/riskControls";
import type { ClosedPaperTrade } from "./execution/paperStrategyRuntime";
import { StrategyLifecycleMonitorService } from "./execution/strategyLifecycleMonitorService";

const events = new EventLogService();
const audit = new ExecutionAuditLog();
const monitor = new StrategyLifecycleMonitorService(events, audit);
const trades = [20, 18, 15, 12, 10, -8, -10, -12, -14, -16].map((pnl, index) => trade(pnl, index));
const report = monitor.analyze("decaying-strategy", trades, new Date("2026-06-20T12:00:00.000Z"));

assert.equal(report.sampleSize, 10);
assert.equal(report.decayDetected, true);
assert.equal(report.recommendation, "retire");
assert.equal(report.status, "pending_human_review");
assert.equal(report.automaticallyApplied, false);
assert.ok(report.driftSignals.length >= 2);
assert.equal(events.countByType("strategy.lifecycle_evaluated"), 1);

const reviewed = monitor.review("decaying-strategy", "approved", "risk-officer", new Date("2026-06-20T12:05:00.000Z"));
assert.equal(reviewed.status, "approved");
assert.equal(reviewed.reviewedBy, "risk-officer");
assert.equal(reviewed.automaticallyApplied, false);
assert.ok(audit.list().some((entry) => entry.action === "strategy.lifecycle.review"));

const insufficient = monitor.analyze("new-strategy", [trade(5, 0, "new-strategy")]);
assert.equal(insufficient.recommendation, "maintain");
assert.equal(insufficient.status, "monitoring");
assert.match(insufficient.driftSignals[0], /Insufficient sample/);
assert.throws(() => monitor.review("new-strategy", "approved", "reviewer"), /does not require review/);

console.log("strategyLifecycleMonitorService smoke tests passed");

function trade(realizedPnL: number, index: number, strategyId = "decaying-strategy"): ClosedPaperTrade {
  const entryPrice = 100;
  const exitPrice = 100 + realizedPnL;
  return {
    id: `${strategyId}-${index}`,
    strategyId,
    symbol: "EUR/USD",
    side: "buy",
    units: 1,
    entryPrice,
    currentPrice: exitPrice,
    stopLoss: 90,
    takeProfit: 120,
    trailingStopDistance: null,
    highestPrice: Math.max(entryPrice, exitPrice),
    lowestPrice: Math.min(entryPrice, exitPrice),
    unrealizedPnL: 0,
    openedAt: `2026-06-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    lifecycleId: `lifecycle-${index}`,
    thesis: "Test thesis",
    entryReason: "Test entry",
    expectedMove: "Positive move",
    riskTaken: 10,
    exitPrice,
    exitReason: realizedPnL >= 0 ? "take_profit" : "stop_loss",
    realizedPnL,
    actualMove: realizedPnL,
    closedAt: `2026-06-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`,
  };
}
