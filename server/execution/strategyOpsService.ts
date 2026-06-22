import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import type { Candle, CandleTimeframe } from "./candleBuilderService";
import { DEFAULT_EVENT_RISK_SETTINGS, economicEventRiskService, type EconomicEventRiskService, type EventRiskSettings } from "./economicEventRiskService";
import { executionRiskPrecheckService, type ExecutionRiskPrecheckService, type RiskPrecheckContext } from "./riskPrecheck";
import { executionAuditLog, executionRiskService, type ExecutionAuditLog, type ExecutionRiskService } from "./riskControls";
import { signalQualityFilter, type SignalQualityFilter, type SignalQualityInput } from "./signalQuality";
import { paperStrategyRuntime, type PaperStrategyRuntime } from "./paperStrategyRuntime";
import { marketDataMetrics, type MarketDataMetrics } from "./marketDataMetrics";
import { automationLevelService, type AutomationLevelService } from "./automationLevels";
import { executionEmergencyState } from "./emergencyControls";
import { strategyEvidenceStore } from "./strategyEvidenceStore";
import { publishTelegramLifecycleAlert } from "../telegramNotificationBus";

export type StrategyRuleDecision = {
  candidate: boolean;
  side?: "buy" | "sell";
  confidence: number;
  thesis: string;
  entryReason: string;
  expectedMove: string;
  stopLoss?: number;
  takeProfit?: number;
};

export type OperationalStrategy = {
  id: string;
  name: string;
  symbols: string[];
  timeframe: CandleTimeframe;
  route: "paper" | "sandbox_confirmation";
  enabled: boolean;
  units: number;
  evaluate(candle: Candle, history: Candle[]): StrategyRuleDecision;
  quality(candle: Candle, decision: StrategyRuleDecision): SignalQualityInput;
  riskContext(candle: Candle, decision: StrategyRuleDecision): RiskPrecheckContext;
  eventRiskSettings?: EventRiskSettings;
};

export class StrategyOpsService {
  private strategies = new Map<string, OperationalStrategy>();
  private states = new Map<string, { evaluations: number; signals: number; lastEvaluatedAt: string | null; lastSignalAt: string | null; status: string }>();
  private signals: Array<Record<string, unknown>> = [];

  constructor(
    private readonly qualityFilter: SignalQualityFilter = signalQualityFilter,
    private readonly riskPrecheck: ExecutionRiskPrecheckService = executionRiskPrecheckService,
    private readonly runtime: PaperStrategyRuntime = paperStrategyRuntime,
    private readonly eventRisk: EconomicEventRiskService = economicEventRiskService,
    private readonly risk: ExecutionRiskService = executionRiskService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly events: EventLogService = eventLogService,
    private readonly metrics: MarketDataMetrics = marketDataMetrics,
    private readonly automation: AutomationLevelService = automationLevelService,
  ) {}

  subscribe(strategy: OperationalStrategy) {
    this.strategies.set(strategy.id, { ...strategy, symbols: [...strategy.symbols] });
    this.states.set(strategy.id, { evaluations: 0, signals: 0, lastEvaluatedAt: null, lastSignalAt: null, status: strategy.enabled ? "active" : "paused" });
    return this.getState(strategy.id);
  }

  unsubscribe(strategyId: string) {
    this.strategies.delete(strategyId);
    this.states.delete(strategyId);
  }

  setEnabled(strategyId: string, enabled: boolean) {
    const strategy = this.strategies.get(strategyId);
    const state = this.states.get(strategyId);
    if (!strategy || !state) throw new Error("Operational strategy is not registered");
    const previousStatus = state.status;
    strategy.enabled = enabled;
    state.status = enabled ? "active" : "paused";
    if (previousStatus !== state.status) {
      void publishTelegramLifecycleAlert({
        id: `strategy-state-${strategyId}-${state.status}`,
        source: "strategy",
        eventType: enabled ? "strategy.started" : "strategy.paused",
        severity: enabled ? "info" : "warning",
        title: enabled ? "Strategy started" : "Strategy paused",
        message: `${strategy.name} is now ${state.status}.`,
        requiredActions: ["Review strategy status", "Check the strategy lab for evidence"],
      });
    }
    return this.getState(strategyId);
  }

  async onCandle(candle: Candle, history: Candle[] = []) {
    const results = [];
    for (const strategy of Array.from(this.strategies.values())) {
      if (!strategy.enabled || strategy.timeframe !== candle.timeframe || !strategy.symbols.includes(candle.symbol)) continue;
      results.push(await this.evaluate(strategy, candle, history));
    }
    return results;
  }

  listStates() {
    return Array.from(this.strategies.keys()).map((id) => this.getState(id));
  }

  listSignals() {
    return [...this.signals].reverse();
  }

  private async evaluate(strategy: OperationalStrategy, candle: Candle, history: Candle[]) {
    const state = this.states.get(strategy.id)!;
    state.evaluations += 1;
    state.lastEvaluatedAt = candle.endTime;
    if (executionEmergencyState.signalsFrozen) return this.reject(strategy, candle, "New signals are frozen by emergency controls");
    if (!this.automation.allows("signals")) {
      return this.reject(strategy, candle, `Automation Level ${this.automation.snapshot().level} does not allow signals`);
    }
    const autonomy = this.automation.snapshot();
    const constraints = autonomy.level === 6 ? autonomy.semiAutonomousConstraints : null;
    if (autonomy.level === 6 && !constraints) return this.reject(strategy, candle, "Level 6 approval constraints are unavailable");
    if (constraints && !constraints.strategyIds.includes(strategy.id)) return this.reject(strategy, candle, "Strategy is outside the Level 6 approval scope");
    if (constraints && !constraints.allowedInstruments.includes(candle.symbol)) return this.reject(strategy, candle, "Instrument is outside the Level 6 approval scope");
    if (this.risk.snapshot().globalKillSwitch) return this.reject(strategy, candle, "Kill switch is active");
    const eventRisk = this.eventRisk.evaluate(candle.symbol, strategy.eventRiskSettings ?? DEFAULT_EVENT_RISK_SETTINGS, new Date(candle.endTime));
    if (eventRisk.blocked) return this.reject(strategy, candle, eventRisk.reasons.join("; "));
    const decision = strategy.evaluate(candle, history);
    this.metrics.recordStrategyEvaluation(decision.candidate);
    if (!decision.candidate || !decision.side) return this.record(strategy, candle, "no_candidate", { confidence: decision.confidence });
    const quality = this.qualityFilter.evaluate(strategy.quality(candle, decision));
    if (!["accept", "paper_only"].includes(quality.decision)) return this.reject(strategy, candle, `Signal quality: ${quality.decision}`);
    const request = {
      strategyId: strategy.id,
      instrument: candle.symbol,
      side: decision.side,
      type: "market" as const,
      units: strategy.units,
      price: candle.close,
      stopLoss: decision.stopLoss ?? (decision.side === "buy" ? candle.close - Math.max(0.0001, candle.close * 0.005) : candle.close + Math.max(0.0001, candle.close * 0.005)),
      takeProfit: decision.takeProfit,
      mode: "paper" as const,
      explicitUserConfirmation: false,
      correlationId: randomUUID(),
    };
    const riskContext = strategy.riskContext(candle, decision);
    if (constraints) {
      const notional = Math.abs(strategy.units * candle.close);
      const riskAmount = Math.abs(candle.close - request.stopLoss) * strategy.units;
      const riskPct = riskAmount / constraints.referenceEquity * 100;
      if (notional > constraints.maxNotional) return this.reject(strategy, candle, "Requested notional exceeds the Level 6 approval scope");
      if (riskPct > constraints.maxRiskPerTradePct) return this.reject(strategy, candle, "Requested risk exceeds the Level 6 approval scope");
      if (riskContext.dailyLoss >= constraints.maxDailyLoss) return this.reject(strategy, candle, "Daily loss reached the Level 6 approval limit");
      if (riskContext.openPositions >= constraints.maxOpenPositions) return this.reject(strategy, candle, "Open positions reached the Level 6 approval limit");
    }
    const precheck = this.riskPrecheck.evaluate(request, {
      ...riskContext,
      newsBlackoutActive: eventRisk.blocked,
      killSwitchActive: this.risk.snapshot().globalKillSwitch,
    });
    if (!precheck.approved) return this.reject(strategy, candle, precheck.reasons.join("; "));
    const signal = {
      id: randomUUID(),
      strategyId: strategy.id,
      symbol: candle.symbol,
      side: decision.side,
      confidence: decision.confidence,
      qualityScore: quality.score,
      route: strategy.route,
      status: strategy.route === "paper" ? "paper_routed" : "awaiting_sandbox_confirmation",
      createdAt: candle.endTime,
      correlationId: request.correlationId,
    };
    this.signals.push(signal);
    state.signals += 1;
    state.lastSignalAt = candle.endTime;
    if (strategy.route === "paper" && !this.automation.allows("paper_auto_entry")) {
      const status = this.automation.allows("paper_tracking") ? "paper_tracked" : "signal_only";
      signal.status = status;
      return this.record(strategy, candle, status, { signal, quality, precheck });
    }
    if (strategy.route === "sandbox_confirmation" && !this.automation.allows("sandbox_execution")) {
      const status = this.automation.allows("paper_tracking") ? "paper_tracked" : "signal_only";
      signal.status = status;
      return this.record(strategy, candle, status, { signal, quality, precheck });
    }
    if (strategy.route === "paper") {
      const position = this.runtime.open({
        strategyId: strategy.id,
        symbol: candle.symbol,
        side: decision.side,
        units: strategy.units,
        price: candle.close,
        stopLoss: request.stopLoss,
        takeProfit: request.takeProfit,
        thesis: decision.thesis,
        entryReason: decision.entryReason,
        expectedMove: decision.expectedMove,
        evidenceContext: {
          originalStrategyInputs: {
            strategyId: strategy.id,
            name: strategy.name,
            timeframe: strategy.timeframe,
            route: strategy.route,
            units: strategy.units,
            symbols: [...strategy.symbols],
          },
          signalFeatures: {
            decision,
            quality,
            precheck,
          },
          marketRegime: inferMarketRegime(candle, history),
          volatilityState: inferVolatilityState(candle),
          spreadState: "not_measured",
          eventBlackoutProximityMinutes: eventRisk.blocked ? 0 : null,
          riskPrecheck: precheck,
          positionSizingDecision: {
            units: strategy.units,
            notional: strategy.units * candle.close,
            requestedRisk: Math.abs(candle.close - request.stopLoss) * strategy.units,
          },
          lifecycleTimeline: [],
        },
      }, new Date(candle.endTime));
      return this.record(strategy, candle, "paper_opened", { signal, positionId: position.id, quality, precheck });
    }
    return this.record(strategy, candle, "sandbox_confirmation_required", { signal, request, quality, precheck });
  }

  private reject(strategy: OperationalStrategy, candle: Candle, reason: string) {
    if (/stale/i.test(reason)) {
      void publishTelegramLifecycleAlert({
        id: `strategy-stale-${strategy.id}-${candle.endTime}`,
        source: "risk",
        eventType: "stale.data_blocked_strategy",
        severity: "warning",
        title: "Stale data blocked strategy",
        message: `${strategy.name} was blocked for ${candle.symbol}: ${reason}`,
        requiredActions: ["Refresh the market data feed", "Check provider freshness and health"],
      });
    }
    if (/daily loss/i.test(reason)) {
      void publishTelegramLifecycleAlert({
        id: `strategy-daily-loss-${strategy.id}-${candle.endTime}`,
        source: "risk",
        eventType: "daily.loss_limit_triggered",
        severity: "critical",
        title: "Daily loss limit triggered",
        message: `${strategy.name} was blocked for ${candle.symbol}: ${reason}`,
        requiredActions: ["Stop new paper and sandbox activity", "Review risk controls and daily loss limits"],
      });
    }
    return this.record(strategy, candle, "rejected", { reason });
  }

  private record(strategy: OperationalStrategy, candle: Candle, status: string, detail: Record<string, unknown>) {
    const correlationId = typeof detail.signal === "object" && detail.signal
      ? String((detail.signal as Record<string, unknown>).correlationId)
      : randomUUID();
    this.events.append({
      type: "strategy.signal_evaluated",
      userId: "system",
      sourceService: "strategy-ops",
      correlationId,
      payload: { strategyId: strategy.id, symbol: candle.symbol, status, ...detail },
      createdAt: candle.endTime,
    });
    if (status === "rejected") {
      strategyEvidenceStore.recordRejectedSignal({
        strategyId: strategy.id,
        symbol: candle.symbol,
        reason: typeof detail.reason === "string" ? detail.reason : "Signal rejected",
        signalId: correlationId,
        timestamp: candle.endTime,
        regime: inferMarketRegime(candle, []),
        timeframe: candle.timeframe,
        metadata: { ...detail, status },
      });
    }
    this.audit.append({
      action: "strategy.ops.evaluate",
      outcome: status === "rejected" ? "rejected" : status === "paper_opened" ? "created" : "accepted",
      correlationId,
      detail: { strategyId: strategy.id, symbol: candle.symbol, status, ...detail, productionOrderSubmissionEnabled: false },
    });
    return { strategyId: strategy.id, symbol: candle.symbol, status, ...detail };
  }

  private getState(strategyId: string) {
    const strategy = this.strategies.get(strategyId);
    const state = this.states.get(strategyId);
    if (!strategy || !state) return undefined;
    return { strategyId, name: strategy.name, symbols: [...strategy.symbols], timeframe: strategy.timeframe, route: strategy.route, ...state };
  }
}

function inferMarketRegime(candle: Candle, history: Candle[] = []) {
  const recentRange = history.slice(-5).reduce((sum, item) => sum + (item.high - item.low), 0) / Math.max(1, Math.min(5, history.length));
  const trend = candle.close - candle.open;
  if (recentRange > candle.close * 0.01) return "high_volatility";
  if (trend > 0 && candle.close > (history[history.length - 1]?.close ?? candle.close)) return "trending_up";
  if (trend < 0 && candle.close < (history[history.length - 1]?.close ?? candle.close)) return "trending_down";
  return "ranging";
}

function inferVolatilityState(candle: Candle) {
  const rangePct = candle.close ? ((candle.high - candle.low) / candle.close) * 100 : 0;
  if (rangePct > 2) return "high";
  if (rangePct > 0.8) return "moderate";
  return "low";
}

export const strategyOpsService = new StrategyOpsService();
