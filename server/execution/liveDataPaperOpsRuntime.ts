import { z } from "zod";
import { randomUUID } from "crypto";
import { candleBuilderService, type Candle } from "./candleBuilderService";
import { economicEventRiskService } from "./economicEventRiskService";
import { marketDataMetrics } from "./marketDataMetrics";
import { paperStrategyRuntime } from "./paperStrategyRuntime";
import { postTradeReviewService } from "./postTradeReviewService";
import { DemoPriceFeedProvider, priceFeedService } from "./priceFeedService";
import { strategyAdaptationService } from "./strategyAdaptationService";
import { strategyLifecycleMonitorService } from "./strategyLifecycleMonitorService";
import { strategyOpsService, type StrategyRuleDecision } from "./strategyOpsService";
import { strategyLeaseService } from "./strategyLeaseService";
import { transactionalReliabilityRepository } from "./transactionalReliabilityRepository";
import { automationLevelService } from "./automationLevels";
import { semiAutonomousApprovalService } from "./semiAutonomousApprovalService";

export const operationalStrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbols: z.array(z.string().min(1)).min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  route: z.enum(["paper", "sandbox_confirmation"]).default("paper"),
  units: z.number().positive(),
  rule: z.enum(["bullish_candle", "bearish_candle", "range_breakout"]),
  maxTradesPerDay: z.number().int().positive().max(50).default(5),
  maxOpenPositions: z.number().int().positive().max(20).default(2),
  sessionStartHourUtc: z.number().int().min(0).max(23).default(0),
  sessionEndHourUtc: z.number().int().min(0).max(23).default(23),
  stopDistance: z.number().positive(),
  takeProfitDistance: z.number().positive(),
  trailingStopDistance: z.number().positive().nullable().default(null),
});

export class LiveDataPaperOpsRuntime {
  private readonly demoProvider = new DemoPriceFeedProvider();
  private readonly ownerId = `paper-ops-${randomUUID()}`;
  private started = false;

  start() {
    if (this.started) return;
    priceFeedService.onTick((tick) => {
      if (tick.freshness === "stale") return;
      paperStrategyRuntime.onTick(tick).forEach((trade) => {
        postTradeReviewService.reviewPaperTrade(trade);
        strategyLifecycleMonitorService.analyze(trade.strategyId, paperStrategyRuntime.listClosed());
      });
      candleBuilderService.ingestAll(tick);
    });
    candleBuilderService.onCandle((candle) => {
      void this.handleCandle(candle);
    });
    this.started = true;
  }

  async pollDemo(symbol: string) {
    this.start();
    return priceFeedService.poll(this.demoProvider, symbol);
  }

  async registerStrategy(input: z.infer<typeof operationalStrategySchema>) {
    this.start();
    const parsed = operationalStrategySchema.parse(input);
    paperStrategyRuntime.configure({
      strategyId: parsed.id,
      name: parsed.name,
      allowedSymbols: parsed.symbols,
      maxTradesPerDay: parsed.maxTradesPerDay,
      maxOpenPositions: parsed.maxOpenPositions,
      session: { startHourUtc: parsed.sessionStartHourUtc, endHourUtc: parsed.sessionEndHourUtc },
      defaultStopDistance: parsed.stopDistance,
      defaultTakeProfitDistance: parsed.takeProfitDistance,
      trailingStopDistance: parsed.trailingStopDistance,
    });
    const state = strategyOpsService.subscribe({
      id: parsed.id,
      name: parsed.name,
      symbols: parsed.symbols,
      timeframe: parsed.timeframe,
      route: parsed.route,
      enabled: automationLevelService.allows("signals"),
      units: parsed.units,
      evaluate: (candle, history) => evaluateRule(parsed.rule, candle, history, parsed.stopDistance, parsed.takeProfitDistance),
      quality: (_candle, decision) => ({
        sourceReliability: 90,
        strategyValidationScore: 75,
        timeframeQuality: 80,
        trendAlignment: decision.confidence,
        volatilityRegime: 75,
        spreadLiquidityCondition: 85,
        recentFalseSignalRate: 15,
        newsRisk: 10,
        riskRewardRatio: parsed.takeProfitDistance / parsed.stopDistance,
      }),
      riskContext: (candle) => ({
        dataAgeSeconds: 0,
        maxDataAgeSeconds: 30,
        spread: 0,
        maxSpread: Math.max(candle.close * 0.005, 0.0005),
        volatilityPct: candle.close ? (candle.high - candle.low) / candle.close * 100 : 0,
        maxVolatilityPct: 8,
        dailyLoss: 0,
        maxDailyLoss: 250,
        openPositions: paperStrategyRuntime.listOpen().length,
        maxOpenPositions: parsed.maxOpenPositions,
        symbolExposure: 0,
        requestedExposure: parsed.units * candle.close,
        maxSymbolExposure: 200_000,
        correlatedExposure: 0,
        maxCorrelatedExposure: 400_000,
        newsBlackoutActive: false,
        consecutiveLosses: 0,
        maxConsecutiveLosses: 4,
        strategyEnabled: true,
        killSwitchActive: false,
        accountConnected: true,
        accountLastSyncAgeSeconds: 0,
        maxAccountSyncAgeSeconds: 60,
      }),
    });
    if (parsed.route === "paper" && automationLevelService.allows("paper_auto_entry")) {
      await transactionalReliabilityRepository.acquireLease(parsed.id, this.ownerId, 30_000);
      try {
        strategyLeaseService.acquire(parsed.id, this.ownerId);
        paperStrategyRuntime.start(parsed.id);
      } catch (error) {
        await transactionalReliabilityRepository.releaseLease(parsed.id, this.ownerId);
        strategyOpsService.setEnabled(parsed.id, false);
        throw error;
      }
    }
    return state;
  }

  async startStrategy(strategyId: string) {
    automationLevelService.assertAllowed("paper_auto_entry");
    await transactionalReliabilityRepository.acquireLease(strategyId, this.ownerId, 30_000);
    try {
      strategyLeaseService.acquire(strategyId, this.ownerId);
      strategyOpsService.setEnabled(strategyId, true);
      return paperStrategyRuntime.start(strategyId);
    } catch (error) {
      await transactionalReliabilityRepository.releaseLease(strategyId, this.ownerId);
      throw error;
    }
  }

  async stopStrategy(strategyId: string) {
    strategyOpsService.setEnabled(strategyId, false);
    const status = paperStrategyRuntime.stop(strategyId);
    try {
      strategyLeaseService.release(strategyId, this.ownerId);
    } finally {
      await transactionalReliabilityRepository.releaseLease(strategyId, this.ownerId);
    }
    return status;
  }

  async enforceAutomationLevel() {
    if (automationLevelService.allows("signals")) return this.snapshot();
    for (const state of strategyOpsService.listStates()) {
      if (!state) continue;
      strategyOpsService.setEnabled(state.strategyId, false);
      paperStrategyRuntime.stop(state.strategyId);
      strategyLeaseService.release(state.strategyId, this.ownerId);
      await transactionalReliabilityRepository.releaseLease(state.strategyId, this.ownerId);
    }
    return this.snapshot();
  }

  snapshot() {
    const open = paperStrategyRuntime.listOpen();
    const closed = paperStrategyRuntime.listClosed();
    return {
      priceFeeds: priceFeedService.listLatest(),
      strategyOps: strategyOpsService.listStates(),
      paperRuntime: paperStrategyRuntime.listStates(),
      signals: strategyOpsService.listSignals(),
      openPositions: open,
      pnl: {
        unrealized: round(open.reduce((sum, position) => sum + position.unrealizedPnL, 0)),
        realized: round(closed.reduce((sum, trade) => sum + trade.realizedPnL, 0)),
        wins: closed.filter((trade) => trade.realizedPnL > 0).length,
        losses: closed.filter((trade) => trade.realizedPnL < 0).length,
      },
      postTradeReviews: postTradeReviewService.list(),
      adaptationSuggestions: strategyAdaptationService.list(),
      strategyLifecycleReports: strategyLifecycleMonitorService.list(),
      eventBlackouts: economicEventRiskService.list(),
      metrics: marketDataMetrics.snapshot(),
      strategyLeases: strategyLeaseService.list(),
      safety: {
        paperAutomationAllowed: true as const,
        sandboxConfirmationRequired: true as const,
        productionOrderSubmissionEnabled: false as const,
      },
    };
  }

  private async handleCandle(candle: Candle) {
    const autonomy = automationLevelService.snapshot();
    const activeApproval = autonomy.level === 6 ? await semiAutonomousApprovalService.active() : null;
    if (autonomy.level === 6 && !activeApproval) {
      automationLevelService.setLevel(0);
      await this.enforceAutomationLevel();
      return;
    }
    const states = strategyOpsService.listStates()
      .filter((state) => state?.status === "active" && state.route === "paper" && state.timeframe === candle.timeframe && state.symbols.includes(candle.symbol));
    for (const state of states) {
      if (activeApproval && !activeApproval.scope.strategyIds.includes(state!.strategyId)) {
        strategyOpsService.setEnabled(state!.strategyId, false);
        paperStrategyRuntime.stop(state!.strategyId);
        await transactionalReliabilityRepository.releaseLease(state!.strategyId, this.ownerId);
        continue;
      }
      try {
        await transactionalReliabilityRepository.renewLease(state!.strategyId, this.ownerId, 30_000);
        strategyLeaseService.renew(state!.strategyId, this.ownerId);
      } catch {
        strategyOpsService.setEnabled(state!.strategyId, false);
        paperStrategyRuntime.stop(state!.strategyId);
        await transactionalReliabilityRepository.releaseLease(state!.strategyId, this.ownerId);
      }
    }
    await strategyOpsService.onCandle(candle, candleBuilderService.list(candle.symbol, candle.timeframe, 50));
  }
}

function evaluateRule(
  rule: z.infer<typeof operationalStrategySchema>["rule"],
  candle: Candle,
  history: Candle[],
  stopDistance: number,
  takeProfitDistance: number,
): StrategyRuleDecision {
  const previous = history.length > 1 ? history[history.length - 2] : undefined;
  const bullish = candle.close > candle.open;
  const bearish = candle.close < candle.open;
  const breakout = previous ? candle.close > previous.high || candle.close < previous.low : false;
  const candidate = rule === "bullish_candle" ? bullish : rule === "bearish_candle" ? bearish : breakout;
  const side = rule === "bearish_candle" || (rule === "range_breakout" && previous && candle.close < previous.low) ? "sell" as const : "buy" as const;
  return {
    candidate,
    side,
    confidence: candidate ? 80 : 40,
    thesis: `${rule} rule on ${candle.symbol} ${candle.timeframe}`,
    entryReason: candidate ? `${rule} condition closed true` : `${rule} condition was not met`,
    expectedMove: `${takeProfitDistance} favorable price units before ${stopDistance} adverse price units`,
    stopLoss: side === "buy" ? candle.close - stopDistance : candle.close + stopDistance,
    takeProfit: side === "buy" ? candle.close + takeProfitDistance : candle.close - takeProfitDistance,
  };
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const liveDataPaperOpsRuntime = new LiveDataPaperOpsRuntime();
