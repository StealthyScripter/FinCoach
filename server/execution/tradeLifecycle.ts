import { randomUUID } from "crypto";
import { z } from "zod";
import { executionAuditLog } from "./riskControls";

export const tradeLifecycleStateSchema = z.enum([
  "signal_received",
  "validated",
  "rejected",
  "paper_order_created",
  "paper_filled",
  "active",
  "stop_triggered",
  "target_triggered",
  "manually_closed",
  "expired",
  "reviewed",
]);

export type TradeLifecycleState = z.infer<typeof tradeLifecycleStateSchema>;

const TRANSITIONS: Record<TradeLifecycleState, TradeLifecycleState[]> = {
  signal_received: ["validated", "rejected", "expired"],
  validated: ["paper_order_created", "rejected", "expired"],
  rejected: ["reviewed"],
  paper_order_created: ["paper_filled", "rejected", "expired"],
  paper_filled: ["active", "rejected"],
  active: ["stop_triggered", "target_triggered", "manually_closed", "expired"],
  stop_triggered: ["reviewed"],
  target_triggered: ["reviewed"],
  manually_closed: ["reviewed"],
  expired: ["reviewed"],
  reviewed: [],
};

export type TradeLifecycleEvent = {
  id: string;
  tradeId: string;
  from: TradeLifecycleState | null;
  to: TradeLifecycleState;
  reason: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type TradeLifecycle = {
  id: string;
  strategyId: string;
  instrument: string;
  state: TradeLifecycleState;
  correlationId: string;
  predictionReviewRequired: boolean;
  events: TradeLifecycleEvent[];
};

export class TradeLifecycleService {
  private trades = new Map<string, TradeLifecycle>();

  create(input: { strategyId: string; instrument: string; correlationId?: string; metadata?: Record<string, unknown> }) {
    const id = randomUUID();
    const correlationId = input.correlationId ?? randomUUID();
    const event = this.event(id, null, "signal_received", "Signal received", correlationId, input.metadata ?? {});
    const trade: TradeLifecycle = {
      id,
      strategyId: input.strategyId,
      instrument: input.instrument,
      state: "signal_received",
      correlationId,
      predictionReviewRequired: false,
      events: [event],
    };
    this.trades.set(id, trade);
    this.audit(event);
    return clone(trade);
  }

  transition(tradeId: string, to: TradeLifecycleState, reason: string, metadata: Record<string, unknown> = {}) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error("Trade lifecycle not found");
    const target = tradeLifecycleStateSchema.parse(to);
    if (!TRANSITIONS[trade.state].includes(target)) {
      throw new Error(`Invalid trade lifecycle transition: ${trade.state} -> ${target}`);
    }
    const event = this.event(trade.id, trade.state, target, reason, trade.correlationId, metadata);
    trade.state = target;
    trade.events.push(event);
    if (["stop_triggered", "target_triggered", "manually_closed", "expired", "rejected"].includes(target)) {
      trade.predictionReviewRequired = true;
    }
    if (target === "reviewed") trade.predictionReviewRequired = false;
    this.audit(event);
    return clone(trade);
  }

  get(tradeId: string) {
    const trade = this.trades.get(tradeId);
    return trade ? clone(trade) : undefined;
  }

  journal(tradeId: string) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error("Trade lifecycle not found");
    return {
      tradeId: trade.id,
      strategyId: trade.strategyId,
      instrument: trade.instrument,
      finalState: trade.state,
      predictionReviewRequired: trade.predictionReviewRequired,
      timeline: trade.events.map((event) => ({
        state: event.to,
        reason: event.reason,
        createdAt: event.createdAt,
        metadata: event.metadata,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  private event(
    tradeId: string,
    from: TradeLifecycleState | null,
    to: TradeLifecycleState,
    reason: string,
    correlationId: string,
    metadata: Record<string, unknown>,
  ): TradeLifecycleEvent {
    return { id: randomUUID(), tradeId, from, to, reason, correlationId, metadata, createdAt: new Date().toISOString() };
  }

  private audit(event: TradeLifecycleEvent) {
    executionAuditLog.append({
      action: "trade.lifecycle",
      outcome: event.to === "rejected" ? "rejected" : "accepted",
      correlationId: event.correlationId,
      detail: { tradeId: event.tradeId, from: event.from, to: event.to, reason: event.reason, ...event.metadata },
    });
  }
}

function clone(trade: TradeLifecycle): TradeLifecycle {
  return { ...trade, events: trade.events.map((event) => ({ ...event, metadata: { ...event.metadata } })) };
}

export const tradeLifecycleService = new TradeLifecycleService();
