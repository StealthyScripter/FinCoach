import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import type { ClosedPaperTrade } from "./paperStrategyRuntime";

export type StrategyLifecycleRecommendation = "maintain" | "watch" | "pause" | "retire";

export type StrategyLifecycleReport = {
  id: string;
  strategyId: string;
  sampleSize: number;
  baselineSize: number;
  recentSize: number;
  metrics: {
    winRate: number;
    expectancy: number;
    profitFactor: number | null;
    maxDrawdown: number;
    recentWinRate: number;
    recentExpectancy: number;
  };
  driftSignals: string[];
  decayDetected: boolean;
  recommendation: StrategyLifecycleRecommendation;
  status: "monitoring" | "pending_human_review" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  automaticallyApplied: false;
  generatedAt: string;
};

export class StrategyLifecycleMonitorService {
  private reports = new Map<string, StrategyLifecycleReport>();

  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  analyze(strategyId: string, trades: ClosedPaperTrade[], now = new Date()) {
    const ordered = trades
      .filter((trade) => trade.strategyId === strategyId)
      .sort((left, right) => left.closedAt.localeCompare(right.closedAt));
    const recentSize = Math.min(5, ordered.length);
    const recent = ordered.slice(-recentSize);
    const baseline = ordered.slice(0, Math.max(0, ordered.length - recentSize));
    const allMetrics = metrics(ordered);
    const recentMetrics = metrics(recent);
    const baselineMetrics = metrics(baseline);
    const driftSignals: string[] = [];

    if (ordered.length < 6) driftSignals.push("Insufficient sample: at least 6 closed trades are required for lifecycle action.");
    if (baseline.length >= 3 && baselineMetrics.winRate - recentMetrics.winRate >= 0.2) {
      driftSignals.push("Recent win rate fell at least 20 percentage points below the prior baseline.");
    }
    if (baseline.length >= 3 && baselineMetrics.expectancy > 0 && recentMetrics.expectancy <= 0) {
      driftSignals.push("Recent expectancy turned non-positive after a positive prior baseline.");
    }
    if (recent.length >= 3 && consecutiveLosses(recent) >= 3) {
      driftSignals.push("The strategy recorded at least three consecutive recent losses.");
    }
    if (allMetrics.maxDrawdown > Math.max(1, grossProfit(ordered))) {
      driftSignals.push("Maximum drawdown exceeds cumulative gross profit.");
    }

    const actionable = ordered.length >= 6;
    const severe = actionable
      && recentMetrics.expectancy < 0
      && (consecutiveLosses(recent) >= 4 || allMetrics.profitFactor !== null && allMetrics.profitFactor < 0.5);
    const decayed = actionable && driftSignals.length >= 2;
    const recommendation: StrategyLifecycleRecommendation = severe
      ? "retire"
      : decayed
        ? "pause"
        : actionable && driftSignals.length
          ? "watch"
          : "maintain";
    const report: StrategyLifecycleReport = {
      id: randomUUID(),
      strategyId,
      sampleSize: ordered.length,
      baselineSize: baseline.length,
      recentSize: recent.length,
      metrics: {
        winRate: allMetrics.winRate,
        expectancy: allMetrics.expectancy,
        profitFactor: allMetrics.profitFactor,
        maxDrawdown: allMetrics.maxDrawdown,
        recentWinRate: recentMetrics.winRate,
        recentExpectancy: recentMetrics.expectancy,
      },
      driftSignals,
      decayDetected: decayed,
      recommendation,
      status: recommendation === "pause" || recommendation === "retire" ? "pending_human_review" : "monitoring",
      reviewedBy: null,
      reviewedAt: null,
      automaticallyApplied: false,
      generatedAt: now.toISOString(),
    };
    this.reports.set(strategyId, report);
    this.events.append({
      type: "strategy.lifecycle_evaluated",
      userId: "system",
      sourceService: "strategy-lifecycle-monitor",
      correlationId: report.id,
      payload: {
        strategyId,
        sampleSize: report.sampleSize,
        recommendation,
        decayDetected: report.decayDetected,
        automaticallyApplied: false,
      },
      createdAt: report.generatedAt,
    });
    this.audit.append({
      action: "strategy.lifecycle.evaluate",
      outcome: report.status === "pending_human_review" ? "blocked" : "accepted",
      correlationId: report.id,
      detail: { strategyId, recommendation, driftSignals, automaticallyApplied: false },
    });
    return clone(report);
  }

  review(strategyId: string, decision: "approved" | "rejected", reviewedBy: string, now = new Date()) {
    const report = this.reports.get(strategyId);
    if (!report) throw new Error("Strategy lifecycle report not found");
    if (report.status !== "pending_human_review") throw new Error("Strategy lifecycle report does not require review");
    report.status = decision;
    report.reviewedBy = reviewedBy;
    report.reviewedAt = now.toISOString();
    this.audit.append({
      action: "strategy.lifecycle.review",
      outcome: decision === "approved" ? "accepted" : "rejected",
      correlationId: report.id,
      detail: {
        strategyId,
        recommendation: report.recommendation,
        reviewedBy,
        automaticallyApplied: false,
      },
    });
    return clone(report);
  }

  list() {
    return Array.from(this.reports.values())
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .map(clone);
  }
}

function metrics(trades: ClosedPaperTrade[]) {
  if (!trades.length) return { winRate: 0, expectancy: 0, profitFactor: null, maxDrawdown: 0 };
  const wins = trades.filter((trade) => trade.realizedPnL > 0);
  const losses = trades.filter((trade) => trade.realizedPnL < 0);
  const profit = wins.reduce((sum, trade) => sum + trade.realizedPnL, 0);
  const loss = Math.abs(losses.reduce((sum, trade) => sum + trade.realizedPnL, 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.realizedPnL;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    winRate: round(wins.length / trades.length),
    expectancy: round(trades.reduce((sum, trade) => sum + trade.realizedPnL, 0) / trades.length),
    profitFactor: loss === 0 ? null : round(profit / loss),
    maxDrawdown: round(maxDrawdown),
  };
}

function consecutiveLosses(trades: ClosedPaperTrade[]) {
  let count = 0;
  for (let index = trades.length - 1; index >= 0 && trades[index].realizedPnL < 0; index -= 1) count += 1;
  return count;
}

function grossProfit(trades: ClosedPaperTrade[]) {
  return trades.reduce((sum, trade) => sum + Math.max(0, trade.realizedPnL), 0);
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function clone(report: StrategyLifecycleReport): StrategyLifecycleReport {
  return { ...report, metrics: { ...report.metrics }, driftSignals: [...report.driftSignals] };
}

export const strategyLifecycleMonitorService = new StrategyLifecycleMonitorService();
