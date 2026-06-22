import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { normalizeSymbol } from "./domain";
import { executionAuditLog, executionRiskService, type ExecutionAuditLog, type ExecutionRiskService } from "./riskControls";
import { tradeLifecycleService, type TradeLifecycleService } from "./tradeLifecycle";
import { marketDataMetrics, type MarketDataMetrics } from "./marketDataMetrics";
import type { PriceTick } from "./priceFeedService";
import { strategyEvidenceStore, type StrategyTradeEvidenceContext } from "./strategyEvidenceStore";
import { publishTelegramLifecycleAlert } from "../telegramNotificationBus";

export type PaperRuntimeConfig = {
  strategyId: string;
  name: string;
  allowedSymbols: string[];
  maxTradesPerDay: number;
  maxOpenPositions: number;
  session: { startHourUtc: number; endHourUtc: number };
  defaultStopDistance: number;
  defaultTakeProfitDistance: number;
  trailingStopDistance: number | null;
};

export type PaperRuntimePosition = {
  id: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  units: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopDistance: number | null;
  highestPrice: number;
  lowestPrice: number;
  unrealizedPnL: number;
  openedAt: string;
  lifecycleId: string;
  thesis: string;
  entryReason: string;
  expectedMove: string;
  riskTaken: number;
  evidenceContext?: StrategyTradeEvidenceContext;
};

export type ClosedPaperTrade = PaperRuntimePosition & {
  exitPrice: number;
  exitReason: "stop_loss" | "take_profit" | "trailing_stop" | "manual";
  realizedPnL: number;
  actualMove: number;
  closedAt: string;
};

export class PaperStrategyRuntime {
  private configs = new Map<string, PaperRuntimeConfig>();
  private running = new Set<string>();
  private positions = new Map<string, PaperRuntimePosition>();
  private closed: ClosedPaperTrade[] = [];
  private journalEntries: Array<Record<string, unknown>> = [];

  constructor(
    private readonly risk: ExecutionRiskService = executionRiskService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly lifecycle: TradeLifecycleService = tradeLifecycleService,
    private readonly events: EventLogService = eventLogService,
    private readonly metrics: MarketDataMetrics = marketDataMetrics,
  ) {}

  configure(config: PaperRuntimeConfig) {
    if (!config.allowedSymbols.length) throw new Error("Paper runtime requires allowed symbols");
    config.allowedSymbols.forEach((symbol) => {
      if (!normalizeSymbol(symbol)) throw new Error(`Unsupported paper symbol: ${symbol}`);
    });
    this.configs.set(config.strategyId, { ...config, allowedSymbols: [...config.allowedSymbols] });
    return this.status(config.strategyId);
  }

  start(strategyId: string) {
    if (!this.configs.has(strategyId)) throw new Error("Paper strategy is not configured");
    if (this.risk.snapshot().globalKillSwitch) throw new Error("Kill switch is active");
    this.running.add(strategyId);
    this.auditState(strategyId, "started");
    return this.status(strategyId);
  }

  stop(strategyId: string) {
    this.running.delete(strategyId);
    this.auditState(strategyId, "stopped");
    const status = this.status(strategyId);
    if (status) {
      void publishTelegramLifecycleAlert({
        id: `paper-strategy-stopped-${strategyId}`,
        source: "strategy",
        eventType: "strategy.stopped",
        severity: "warning",
        title: "Strategy stopped",
        message: `${status.name} has stopped running.`,
        requiredActions: ["Review the open positions", "Check the strategy evidence and lifecycle report"],
      });
    }
    return this.status(strategyId);
  }

  open(input: {
    strategyId: string;
    symbol: string;
    side: "buy" | "sell";
    units: number;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
    thesis: string;
    entryReason: string;
    expectedMove: string;
    evidenceContext?: StrategyTradeEvidenceContext;
  }, now = new Date()) {
    const config = this.requireRunning(input.strategyId);
    if (this.risk.snapshot().globalKillSwitch) throw new Error("Kill switch is active");
    const instrument = normalizeSymbol(input.symbol);
    if (!instrument || !config.allowedSymbols.some((symbol) => normalizeSymbol(symbol)?.symbol === instrument.symbol)) {
      throw new Error("Symbol is not allowed by paper strategy");
    }
    if (!inSession(now, config.session)) throw new Error("Paper strategy is outside its configured session");
    const openForStrategy = this.listOpen().filter((position) => position.strategyId === input.strategyId);
    if (openForStrategy.length >= config.maxOpenPositions) throw new Error("Paper strategy maximum open positions reached");
    if (this.tradesToday(input.strategyId, now) >= config.maxTradesPerDay) throw new Error("Paper strategy daily trade limit reached");
    const stopLoss = input.stopLoss ?? (input.side === "buy" ? input.price - config.defaultStopDistance : input.price + config.defaultStopDistance);
    const takeProfit = input.takeProfit ?? (input.side === "buy" ? input.price + config.defaultTakeProfitDistance : input.price - config.defaultTakeProfitDistance);
    const lifecycle = this.lifecycle.create({
      strategyId: input.strategyId,
      instrument: instrument.symbol,
      metadata: { source: "paper_strategy_runtime" },
    });
    this.lifecycle.transition(lifecycle.id, "validated", "Paper runtime gates passed");
    this.lifecycle.transition(lifecycle.id, "paper_order_created", "Paper runtime order created");
    this.lifecycle.transition(lifecycle.id, "paper_filled", "Paper runtime fill recorded");
    this.lifecycle.transition(lifecycle.id, "active", "Paper runtime position active");
    const position: PaperRuntimePosition = {
      id: randomUUID(),
      strategyId: input.strategyId,
      symbol: instrument.symbol,
      side: input.side,
      units: input.units,
      entryPrice: input.price,
      currentPrice: input.price,
      stopLoss,
      takeProfit,
      trailingStopDistance: config.trailingStopDistance,
      highestPrice: input.price,
      lowestPrice: input.price,
      unrealizedPnL: 0,
      openedAt: now.toISOString(),
      lifecycleId: lifecycle.id,
      thesis: input.thesis,
      entryReason: input.entryReason,
      expectedMove: input.expectedMove,
      riskTaken: Math.abs(input.price - stopLoss) * input.units,
      evidenceContext: input.evidenceContext,
    };
    this.positions.set(position.id, position);
    this.metrics.recordPaperOpen();
    this.audit.append({
      action: "paper.runtime.open",
      outcome: "filled",
      correlationId: lifecycle.correlationId,
      detail: { positionId: position.id, strategyId: input.strategyId, symbol: instrument.symbol, productionOrderSubmissionEnabled: false },
    });
    this.journalEntries.push({ type: "paper_open", ...position });
    void publishTelegramLifecycleAlert({
      id: `paper-open-${position.id}`,
      source: "paper",
      eventType: "paper.trade_opened",
      severity: "info",
      title: "Paper trade opened",
      message: `${input.strategyId} opened ${position.side} ${position.symbol} at ${position.entryPrice}.`,
      requiredActions: ["Track the paper position", "Review the risk precheck result"],
      createdAt: now.toISOString(),
    });
    return { ...position };
  }

  onTick(tick: PriceTick) {
    const closed: ClosedPaperTrade[] = [];
    for (const position of Array.from(this.positions.values())) {
      if (position.symbol !== tick.symbol) continue;
      position.currentPrice = tick.mid;
      position.highestPrice = Math.max(position.highestPrice, tick.mid);
      position.lowestPrice = Math.min(position.lowestPrice, tick.mid);
      if (position.trailingStopDistance !== null) {
        if (position.side === "buy") position.stopLoss = Math.max(position.stopLoss, position.highestPrice - position.trailingStopDistance);
        else position.stopLoss = Math.min(position.stopLoss, position.lowestPrice + position.trailingStopDistance);
      }
      position.unrealizedPnL = pnl(position.side, position.entryPrice, tick.mid, position.units);
      const stopHit = position.side === "buy" ? tick.bid <= position.stopLoss : tick.ask >= position.stopLoss;
      const targetHit = position.side === "buy" ? tick.bid >= position.takeProfit : tick.ask <= position.takeProfit;
      if (stopHit) {
        const trailing = position.trailingStopDistance !== null
          && ((position.side === "buy" && position.stopLoss > position.entryPrice) || (position.side === "sell" && position.stopLoss < position.entryPrice));
        closed.push(this.close(position.id, tick.mid, trailing ? "trailing_stop" : "stop_loss", new Date(tick.timestamp)));
      } else if (targetHit) {
        closed.push(this.close(position.id, tick.mid, "take_profit", new Date(tick.timestamp)));
      }
    }
    return closed;
  }

  close(positionId: string, exitPrice: number, exitReason: ClosedPaperTrade["exitReason"], now = new Date()) {
    const position = this.positions.get(positionId);
    if (!position) throw new Error("Paper position not found");
    const realizedPnL = pnl(position.side, position.entryPrice, exitPrice, position.units);
    const closed: ClosedPaperTrade = {
      ...position,
      currentPrice: exitPrice,
      unrealizedPnL: 0,
      exitPrice,
      exitReason,
      realizedPnL,
      actualMove: position.side === "buy" ? exitPrice - position.entryPrice : position.entryPrice - exitPrice,
      closedAt: now.toISOString(),
    };
    this.positions.delete(positionId);
    this.closed.unshift(closed);
    this.lifecycle.transition(
      position.lifecycleId,
      exitReason === "take_profit" ? "target_triggered" : exitReason === "manual" ? "manually_closed" : "stop_triggered",
      `Paper position closed: ${exitReason}`,
      { positionId, exitPrice, realizedPnL },
    );
    this.metrics.recordPaperClose();
    this.events.append({
      type: "paper.trade_closed",
      userId: "system",
      sourceService: "paper-strategy-runtime",
      correlationId: this.lifecycle.get(position.lifecycleId)?.correlationId,
      payload: { positionId, strategyId: position.strategyId, symbol: position.symbol, exitReason, realizedPnL },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "paper.runtime.close",
      outcome: "accepted",
      correlationId: this.lifecycle.get(position.lifecycleId)?.correlationId ?? position.id,
      detail: { positionId, exitReason, realizedPnL },
    });
    void publishTelegramLifecycleAlert({
      id: `paper-close-${closed.id}`,
      source: "paper",
      eventType: "paper.trade_closed",
      severity: realizedPnL < 0 ? "warning" : "info",
      title: "Paper trade closed",
      message: `${position.strategyId} closed ${position.symbol} with ${exitReason} and P/L ${realizedPnL}.`,
      requiredActions: ["Review the post-trade review", "Check the strategy evidence store"],
      createdAt: now.toISOString(),
    });
    const evidenceContext = position.evidenceContext;
    const evidenceTimeframe = typeof evidenceContext?.originalStrategyInputs?.timeframe === "string"
      ? evidenceContext.originalStrategyInputs.timeframe
      : null;
    strategyEvidenceStore.recordClosedTrade({
      strategyId: position.strategyId,
      symbol: position.symbol,
      tradeKind: "paper_trade",
      verdict: realizedPnL > 0 ? "healthy" : realizedPnL < 0 ? "watch" : "accept",
      summary: `${position.side} ${position.symbol} closed ${exitReason} with P/L ${realizedPnL}.`,
      outcome: realizedPnL > 0 ? "win" : realizedPnL < 0 ? "loss" : "breakeven",
      timestamp: now.toISOString(),
      regime: evidenceContext?.marketRegime ?? null,
      timeframe: evidenceTimeframe,
      title: `${position.strategyId} paper close`,
      source: "paper-strategy-runtime",
      metadata: {
        ...evidenceContext,
        exitReason,
        realizedPnL,
        tradeLifecycle: this.lifecycle.journal(position.lifecycleId),
      },
    });
    this.journalEntries.push({ type: "paper_close", ...closed });
    return { ...closed };
  }

  listOpen() { return Array.from(this.positions.values()).map((position) => ({ ...position })); }
  listClosed() { return this.closed.map((trade) => ({ ...trade })); }
  journal() { return [...this.journalEntries].reverse(); }
  listStates() { return Array.from(this.configs.keys()).map((id) => this.status(id)); }

  status(strategyId: string) {
    const config = this.configs.get(strategyId);
    if (!config) return undefined;
    return {
      strategyId,
      name: config.name,
      running: this.running.has(strategyId),
      allowedSymbols: [...config.allowedSymbols],
      tradesToday: this.tradesToday(strategyId, new Date()),
      openPositions: this.listOpen().filter((position) => position.strategyId === strategyId).length,
      maxTradesPerDay: config.maxTradesPerDay,
      maxOpenPositions: config.maxOpenPositions,
      productionOrderSubmissionEnabled: false as const,
    };
  }

  private requireRunning(strategyId: string) {
    const config = this.configs.get(strategyId);
    if (!config || !this.running.has(strategyId)) throw new Error("Paper strategy is not running");
    return config;
  }

  private tradesToday(strategyId: string, now: Date) {
    const date = now.toISOString().slice(0, 10);
    return this.closed.filter((trade) => trade.strategyId === strategyId && trade.openedAt.startsWith(date)).length
      + this.listOpen().filter((position) => position.strategyId === strategyId && position.openedAt.startsWith(date)).length;
  }

  private auditState(strategyId: string, state: "started" | "stopped") {
    this.audit.append({
      action: `paper.runtime.${state}`,
      outcome: "accepted",
      correlationId: randomUUID(),
      detail: { strategyId, productionOrderSubmissionEnabled: false },
    });
  }
}

function inSession(now: Date, session: PaperRuntimeConfig["session"]) {
  const hour = now.getUTCHours();
  if (session.startHourUtc === session.endHourUtc) return true;
  return session.startHourUtc <= session.endHourUtc
    ? hour >= session.startHourUtc && hour < session.endHourUtc
    : hour >= session.startHourUtc || hour < session.endHourUtc;
}

function pnl(side: "buy" | "sell", entry: number, exit: number, units: number) {
  return Number(((side === "buy" ? exit - entry : entry - exit) * units).toFixed(2));
}

export const paperStrategyRuntime = new PaperStrategyRuntime();
