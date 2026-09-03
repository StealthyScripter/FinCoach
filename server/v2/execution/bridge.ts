import { createHash, randomUUID } from "node:crypto";
import type { OrderRequest } from "../../execution/domain";
import type { SandboxOrderResult, SandboxTrade } from "../../execution/brokerSandbox";
import { sandboxBrokerRuntime, type SandboxBrokerRuntime } from "../../execution/sandboxBrokerRuntime";
import { evaluateDemoExecutionEligibility } from "./eligibility";
import type { DemoEligibilityInput, DemoPromotionRecord, V2ExecutionRequest } from "./contracts";
import type { InMemoryV2ExecutionRequestRepository, PgV2ExecutionRequestRepository } from "./repository";
import type { ExternalEvaluation } from "../external-evaluation";

type RequestRepository = Pick<PgV2ExecutionRequestRepository | InMemoryV2ExecutionRequestRepository, "save" | "get" | "getBySignal" | "update">;
type SignalLike = DemoEligibilityInput["signal"];
type StrategyLike = DemoEligibilityInput["strategy"];
type ForwardLike = DemoEligibilityInput["forwardTest"];
type LifecycleLike = DemoEligibilityInput["lifecycle"];

export type V2ExecutionBridgeInput = {
  signal: SignalLike;
  strategy: StrategyLike;
  forwardTest: ForwardLike;
  lifecycle: LifecycleLike;
  promotion?: DemoPromotionRecord | null;
  killSwitchActive: boolean;
  practiceCapacityAvailable: boolean;
  now?: Date;
};

export type V2ExecutionBridgeResult = {
  eligibility: ReturnType<typeof evaluateDemoExecutionEligibility>;
  request: V2ExecutionRequest | null;
  brokerResult: SandboxOrderResult | null;
};

export class V2OandaPracticeExecutionBridge {
  constructor(private readonly requests: RequestRepository, private readonly broker: Pick<SandboxBrokerRuntime, "submitAutonomousPractice"> = sandboxBrokerRuntime) {}

  async process(input: V2ExecutionBridgeInput): Promise<V2ExecutionBridgeResult> {
    const eligibility = evaluateDemoExecutionEligibility(input);
    const existing = await this.requests.getBySignal(input.signal.signalId);
    if (existing) {
      if (existing.status === "eligible" || existing.status === "submitted") {
        try {
          const brokerResult = await this.broker.submitAutonomousPractice(toOrderRequest(existing), existing.idempotencyKey);
          const updated = await this.requests.update(existing.executionRequestId, { status: brokerResult.status === "rejected" ? "rejected" : brokerResult.status === "filled" || brokerResult.status === "partially_filled" ? "filled" : "accepted", brokerOrderId: brokerResult.orderId || null, brokerTradeId: brokerResult.brokerTradeId ?? null, brokerFillTransactionId: brokerResult.brokerFillTransactionId ?? null, entryPriceFilled: brokerResult.averageFillPrice ?? null, submittedAt: brokerResult.submittedAt, filledAt: brokerResult.filledUnits ? brokerResult.submittedAt : null, brokerStatus: brokerResult.status });
          return { eligibility: { ...eligibility, eligible: true, reason: "duplicate_execution_request_recovered" }, request: updated ?? existing, brokerResult };
        } catch { /* leave durable request for bounded retry/reconciliation */ }
      }
      return { eligibility: { ...eligibility, eligible: false, reason: "duplicate_execution_request" }, request: existing, brokerResult: null };
    }
    const now = input.now ?? new Date();
    if (!eligibility.eligible) {
      const rejected = buildRequest(input, eligibility, now, "failed");
      const saved = await this.requests.save(rejected);
      return { eligibility, request: saved.record, brokerResult: null };
    }
    const executionRequestId = createHash("sha256").update(`v2-execution:${input.signal.signalId}`).digest("hex").slice(0, 32);
    const request = buildRequest(input, { ...eligibility, eligible: true }, now, "eligible", executionRequestId);
    const saved = await this.requests.save(request);
    const persisted = saved.record;
    if (!saved.inserted) return { eligibility: { ...eligibility, eligible: false, reason: "duplicate_execution_request" }, request: persisted, brokerResult: null };
    try {
      const brokerResult = await this.broker.submitAutonomousPractice(toOrderRequest(persisted), persisted.idempotencyKey);
      const status = brokerResult.status === "rejected" ? "rejected" : brokerResult.status === "filled" || brokerResult.status === "partially_filled" ? "filled" : "accepted";
      const updated = await this.requests.update(persisted.executionRequestId, {
        status, brokerOrderId: brokerResult.orderId || null, brokerTradeId: brokerResult.brokerTradeId ?? null,
        brokerFillTransactionId: brokerResult.brokerFillTransactionId ?? null, entryPriceFilled: brokerResult.averageFillPrice ?? null,
        submittedAt: brokerResult.submittedAt, filledAt: brokerResult.filledUnits ? brokerResult.submittedAt : null,
        brokerStatus: brokerResult.status,
      });
      return { eligibility, request: updated ?? persisted, brokerResult };
    } catch (error) {
      const updated = await this.requests.update(persisted.executionRequestId, { status: "failed", brokerStatus: error instanceof Error ? error.message : "submission_failed" });
      return { eligibility, request: updated ?? persisted, brokerResult: null };
    }
  }

  async reconcileClosedTrades(closedTrades: SandboxTrade[], now = new Date(), onOutcome?: (request: V2ExecutionRequest) => Promise<void> | void) {
    const outcomes: V2ExecutionRequest[] = [];
    for (const trade of closedTrades) {
      const request = await findRequestByTrade(this.requests, trade.id);
      if (!request || request.status === "closed") continue;
      const risk = Math.abs(request.entryPrice - request.stopLoss) * request.requestedUnits;
      const pnl = trade.realizedPnL ?? null;
      const closed = await this.requests.update(request.executionRequestId, { status: "closed", brokerTradeId: trade.id, closedAt: trade.closedAt ?? now.toISOString(), realizedPnL: pnl, realizedR: pnl !== null && risk > 0 ? pnl / risk : null, brokerStatus: "closed" });
      if (closed) { outcomes.push(closed); await onOutcome?.(closed); }
    }
    return outcomes;
  }
}

function buildRequest(input: V2ExecutionBridgeInput, eligibility: V2ExecutionBridgeResult["eligibility"], now: Date, status: V2ExecutionRequest["status"], executionRequestId = createHash("sha256").update(`v2-execution:${input.signal.signalId}`).digest("hex").slice(0, 32)): V2ExecutionRequest {
  return {
    executionRequestId, schemaVersion: "fincoach.v2.execution-request.1", strategyId: input.signal.strategyId, signalId: input.signal.signalId, forwardTestId: input.signal.forwardTestId,
    researchLineageEventIds: [...new Set(input.signal.lineageEventIds)], instrument: input.signal.symbol, side: input.signal.side, entryPrice: input.signal.entryPrice, stopLoss: input.signal.stopLoss, takeProfit: input.signal.takeProfit,
    requestedRisk: Math.abs(input.signal.entryPrice - input.signal.stopLoss), requestedUnits: practiceUnits(), eligibility, status, idempotencyKey: `v2:${input.signal.signalId}`,
    brokerOrderId: null, brokerTradeId: null, brokerFillTransactionId: null, entryPriceFilled: null, submittedAt: null, filledAt: null, closedAt: null, realizedPnL: null, realizedR: null, brokerStatus: status === "failed" ? eligibility.reason : null,
    createdAt: now.toISOString(), correlationId: input.signal.correlationId, causationId: input.signal.causationId, lineageEventIds: [...new Set([...input.signal.lineageEventIds, input.signal.signalId])],
  };
}

export function externalEvaluationFromBrokerOutcome(request: V2ExecutionRequest): ExternalEvaluation | null {
  if (request.status !== "closed" || request.realizedPnL === null || !request.closedAt) return null;
  const outcome = request.realizedPnL > 0 ? "tp" : request.realizedPnL < 0 ? "sl" : "cancelled";
  return {
    evaluationId: createHash("sha256").update(`oanda-practice-evaluation:${request.executionRequestId}`).digest("hex").slice(0, 32),
    schemaVersion: "fincoach.v2.external-evaluation.1", signalId: request.signalId, strategyId: request.strategyId, forwardTestId: request.forwardTestId,
    executionRequestId: request.executionRequestId, brokerTradeId: request.brokerTradeId ?? undefined, evaluationSource: "oanda_practice", evaluatorVersion: "oanda-practice-reconciliation.v1",
    entryReached: true, slReached: outcome === "sl", tpReached: outcome === "tp", outcome, r: request.realizedR ?? 0, profitLoss: request.realizedPnL,
    mfe: 0, mae: 0, holdingDurationMinutes: request.filledAt ? Math.max(0, (Date.parse(request.closedAt) - Date.parse(request.filledAt)) / 60_000) : 0,
    dataSource: "oanda_practice", evaluatedAt: request.closedAt, notes: "Authoritative OANDA PRACTICE closed-trade outcome.", lineageEventIds: [...new Set([...request.lineageEventIds, request.executionRequestId, request.brokerTradeId ?? ""])].filter(Boolean), correlationId: request.correlationId, causationId: request.causationId,
  };
}

async function findRequestByTrade(repository: RequestRepository, tradeId: string) {
  // Pg repository uses a JSONB lookup; the in-memory implementation exposes list only for diagnostics.
  const candidate = (repository as RequestRepository & { getByBrokerTrade?: (id: string) => Promise<V2ExecutionRequest | null> }).getByBrokerTrade?.(tradeId);
  if (candidate) return await candidate;
  const list = (repository as InMemoryV2ExecutionRequestRepository).list?.() ?? [];
  return list.find(item => item.brokerTradeId === tradeId) ?? null;
}

function toOrderRequest(request: V2ExecutionRequest): OrderRequest {
  return { strategyId: request.strategyId, instrument: request.instrument, side: request.side, type: "market", units: request.requestedUnits, price: request.entryPrice, stopLoss: request.stopLoss, takeProfit: request.takeProfit, mode: "paper", explicitUserConfirmation: false, correlationId: request.correlationId, clientOrderId: request.idempotencyKey };
}

function practiceUnits() {
  const value = Number(process.env.FINCOACH_V2_PRACTICE_UNITS ?? 1);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : 1;
}
