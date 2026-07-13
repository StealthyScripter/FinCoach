import { randomUUID } from "crypto";
import { storage } from "../storage";
import { demoRunService } from "../demoRunService";
import { strategyResearchSchedulerService } from "../strategyResearchSchedulerService";
import { executionRiskService, summarizePositions } from "../execution/riskControls";
import { paperStrategyRuntime } from "../execution/paperStrategyRuntime";
import { strategyEvidenceStore } from "../execution/strategyEvidenceStore";
import { providerRegistryService } from "../providerRegistryService";
import { telegramMetrics } from "./metrics";
import { telegramRepository, type TelegramRepository } from "./repository";
import type { TelegramSummaryRecord } from "./contracts";

export type StrategyPerformanceInput = {
  strategyId: string;
  name: string;
  version: number;
  status: string;
  instrument: string;
  timeframe: string;
  trades: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  capitalAllocated: number;
  totalRiskCommitted: number;
  maximumDrawdown: number;
  evidenceScore: number;
  forwardTestDuration: string;
  confidenceCalibration: string;
  promotionState: string;
  averageR: number | null;
};

export type TelegramSummaryResult = {
  summary: TelegramSummaryRecord;
  status: "created" | "existing";
};

export class TelegramReportingService {
  constructor(private readonly repository: TelegramRepository = telegramRepository) {}

  async statusMessage() {
    const demo = await demoRunService.status().catch(() => null);
    const pipeline = strategyResearchSchedulerService.snapshot();
    const providers = providerRegistryService.getSnapshot();
    const risk = executionRiskService.snapshot();
    const open = paperStrategyRuntime.listOpen();
    return [
      "FinCoach Status",
      `State: running`,
      `Demo run: ${demo?.state ?? "unknown"}`,
      `Research pipeline: ${pipeline.health.status}`,
      `Providers: ${providers.providers.map((provider) => `${provider.id}:${provider.status}`).join(", ") || "none"}`,
      `Data freshness: ${pipeline.historicalDataCoverage.length ? "tracked" : "unknown"}`,
      `Kill switch: ${risk.globalKillSwitch ? "ACTIVE" : "inactive"}`,
      `Open demo trades: ${open.length}`,
      "Live execution: blocked",
    ].join("\n");
  }

  openTradesMessage() {
    const open = paperStrategyRuntime.listOpen();
    if (open.length === 0) return "Environment: DEMO/PAPER/PRACTICE\nNo open demo trades.";
    return [
      "Environment: DEMO/PAPER/PRACTICE",
      ...open.slice(0, 10).map((trade) => [
        `${trade.symbol} ${trade.side}`,
        `Entry: ${trade.entryPrice}`,
        `Current: ${trade.currentPrice}`,
        `Unrealized P/L: ${trade.unrealizedPnL}`,
        `Strategy: ${trade.strategyId}`,
      ].join(" | ")),
    ].join("\n");
  }

  exposureMessage() {
    const positions = paperStrategyRuntime.listOpen().map((trade) => ({
      id: trade.id,
      instrument: trade.symbol,
      side: trade.side,
      units: trade.units,
      entryPrice: trade.entryPrice,
      currentPrice: trade.currentPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      unrealizedPnL: trade.unrealizedPnL,
      realizedPnL: 0,
      marginUsed: 0,
      staleData: false,
      stopLossStatus: "active" as const,
      takeProfitStatus: "active" as const,
      openedAt: trade.openedAt,
      updatedAt: new Date().toISOString(),
    }));
    const exposure = summarizePositions(positions);
    return [
      "Environment: DEMO/PAPER/PRACTICE",
      `Gross exposure: ${exposure.exposure}`,
      `Net exposure: ${exposure.exposure}`,
      `Open positions: ${exposure.openPositions}`,
      `Unrealized demo P/L: ${exposure.unrealizedPnL}`,
      `Correlated exposure warnings: ${exposure.correlation}`,
      "Remaining demo risk capacity: tracked by demo risk controls",
    ].join("\n");
  }

  async dailySummary(now = new Date()) {
    return (await this.dailySummaryResult(now)).summary;
  }

  async dailySummaryResult(now = new Date()): Promise<TelegramSummaryResult> {
    const summaryDate = now.toISOString().slice(0, 10);
    const existing = await this.repository.findSummaryByPeriodAndDate("daily", summaryDate);
    if (existing) {
      validateSummaryForPeriod(existing, "daily", summaryDate);
      telegramMetrics.recordSummaryResult("daily", "existing");
      return { summary: existing, status: "existing" };
    }
    const createdAt = now.toISOString();
    const demo = await demoRunService.status().catch(() => null);
    const telemetry = await demoRunService.telemetry().catch(() => null);
    const pipeline = strategyResearchSchedulerService.snapshot();
    const evidence = strategyEvidenceStore.snapshot();
    const report = {
      generatedAt: now.toISOString(),
      system: { uptimeSeconds: demo?.uptimeSeconds ?? 0, reliability: telemetry?.reliability ?? null },
      demoRun: demo,
      research: pipeline.counts,
      signals: telegramMetrics.snapshot(),
      rejectedSignals: evidence.rejectedSignals.slice(0, 10),
      safety: telemetry?.safety ?? null,
      nextResearchPriority: pipeline.latestRejectionReasons[0] ?? "Continue evidence collection and validation.",
      disclaimer: "Historical performance is not guaranteed future performance. FinCoach is demo-only.",
    };
    const conciseMessage = [
      "Daily FinCoach Summary",
      `Demo run: ${demo?.state ?? "unknown"}`,
      `Research cycles: ${pipeline.health.cyclesRun}`,
      `Patterns discovered: ${pipeline.counts.patternsDetected}`,
      `Experiments created: ${pipeline.counts.experimentsCreated}`,
      `Backtests completed: ${pipeline.counts.backtestsRun}`,
      `Signals published/suppressed: ${telegramMetrics.snapshot().signalsPublished}/${telegramMetrics.snapshot().signalsRejected}`,
      `Safety blocks: ${pipeline.health.safetyBlocks}`,
      `Next: ${report.nextResearchPriority}`,
      "Live execution: blocked",
    ].join("\n");
    const candidateId = randomUUID();
    const record = await this.repository.saveSummary({
      id: candidateId,
      period: "daily",
      summaryDate,
      conciseMessage,
      report,
      deliveryId: null,
      createdAt,
    });
    const status = record.id === candidateId ? "created" : "existing";
    validateSummaryForPeriod(record, "daily", summaryDate);
    telegramMetrics.recordSummaryResult("daily", status);
    return { summary: record, status };
  }

  async weeklySummary(now = new Date()) {
    return (await this.weeklySummaryResult(now)).summary;
  }

  async weeklySummaryResult(now = new Date()): Promise<TelegramSummaryResult> {
    const summaryDate = weekKey(now);
    const existing = await this.repository.findSummaryByPeriodAndDate("weekly", summaryDate);
    if (existing) {
      validateSummaryForPeriod(existing, "weekly", summaryDate);
      telegramMetrics.recordSummaryResult("weekly", "existing");
      return { summary: existing, status: "existing" };
    }
    const createdAt = now.toISOString();
    const pipeline = strategyResearchSchedulerService.snapshot();
    const metrics = telegramMetrics.snapshot();
    const report = {
      generatedAt: now.toISOString(),
      providerReliability: providerRegistryService.getSnapshot().providers.map((provider) => ({ id: provider.id, health: provider.status })),
      researchThroughput: pipeline.counts,
      strategyPerformance: this.strategyPerformance(),
      signals: metrics,
      comparisons: { priorWeek: "not_available", experimentBaseline: "tracked where available", benchmark: "not_available" },
      comingWeekResearchPlan: pipeline.latestRejectionReasons.slice(0, 3),
      disclaimer: "Historical performance is not guaranteed future performance. FinCoach is demo-only.",
    };
    const conciseMessage = [
      "Weekly FinCoach Summary",
      `Research cycles: ${pipeline.health.cyclesRun}`,
      `Experiments run: ${pipeline.counts.experimentsCreated}`,
      `Backtests run: ${pipeline.counts.backtestsRun}`,
      `Stable candidates: ${pipeline.counts.promoted}`,
      `Signals published/rejected: ${metrics.signalsPublished}/${metrics.signalsRejected}`,
      `Average signal R: ${metrics.averageSignalR ?? "not_available"}`,
      "Live execution: blocked",
    ].join("\n");
    const candidateId = randomUUID();
    const record = await this.repository.saveSummary({
      id: candidateId,
      period: "weekly",
      summaryDate,
      conciseMessage,
      report,
      deliveryId: null,
      createdAt,
    });
    const status = record.id === candidateId ? "created" : "existing";
    validateSummaryForPeriod(record, "weekly", summaryDate);
    telegramMetrics.recordSummaryResult("weekly", status);
    return { summary: record, status };
  }

  strategyPerformance(input?: StrategyPerformanceInput[]) {
    const strategies = input ?? [];
    return strategies.map((strategy) => {
      const absoluteGrossLoss = Math.abs(strategy.grossLoss);
      return {
        ...strategy,
        winRate: strategy.trades > 0 ? strategy.wins / strategy.trades : null,
        profitFactor: absoluteGrossLoss > 0 ? strategy.grossProfit / absoluteGrossLoss : null,
        expectancy: strategy.trades > 0 ? strategy.netProfit / strategy.trades : null,
        returnPercentage: strategy.capitalAllocated > 0 ? strategy.netProfit / strategy.capitalAllocated * 100 : null,
        returnOnRiskPercentage: strategy.totalRiskCommitted > 0 ? strategy.netProfit / strategy.totalRiskCommitted * 100 : null,
      };
    });
  }

  async todayMessage() {
    const summaries = await this.repository.listSummaries("daily", 1);
    return summaries[0]?.conciseMessage ?? (await this.dailySummary()).conciseMessage;
  }

  async weekMessage() {
    const summaries = await this.repository.listSummaries("weekly", 1);
    return summaries[0]?.conciseMessage ?? (await this.weeklySummary()).conciseMessage;
  }

  async markDelivered(summaryId: string, deliveryId: string) {
    return this.repository.markSummaryDelivered(summaryId, deliveryId);
  }
}

function validateSummaryForPeriod(record: TelegramSummaryRecord, period: "daily" | "weekly", summaryDate: string) {
  if (!record || typeof record !== "object") throw new Error("malformed persisted summary row");
  if (record.period !== period) throw new Error(`invalid summary period: expected ${period}, received ${record.period}`);
  if (record.summaryDate !== summaryDate) throw new Error(`invalid summary date: expected ${summaryDate}, received ${record.summaryDate}`);
  if (!record.id || !record.conciseMessage || !record.createdAt) throw new Error("missing required summary fields");
  if (!record.report || typeof record.report !== "object") throw new Error("malformed persisted summary report");
}

function weekKey(date: Date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - first.getTime()) / 86_400_000);
  return `${date.getUTCFullYear()}-W${String(Math.ceil((day + first.getUTCDay() + 1) / 7)).padStart(2, "0")}`;
}

export const telegramReportingService = new TelegramReportingService();
