import { createHash, randomUUID } from "crypto";
import type { OrderRequest } from "./domain";
import { normalizeSymbol } from "./domain";
import { executionAuditLog } from "./riskControls";

export type ControlledOrderPreviewInput = {
  request: OrderRequest;
  accountEquity: number;
  currentPortfolioExposure: number;
  estimatedSpread: number;
  commissionRate: number;
  estimatedSlippageRate: number;
  invalidationRule: string;
  provider: string;
  environment: "sandbox" | "live";
};

export class OrderPreviewService {
  create(input: ControlledOrderPreviewInput, now = new Date()) {
    const instrument = normalizeSymbol(input.request.instrument);
    if (!instrument) throw new Error("Unsupported preview instrument");
    if (!input.invalidationRule.trim()) throw new Error("Order preview requires an invalidation rule");
    const notionalValue = input.request.units * input.request.price;
    const estimatedMargin = notionalValue * instrument.marginRequirement;
    const estimatedSpreadCost = input.request.units * input.estimatedSpread;
    const estimatedCommission = notionalValue * input.commissionRate;
    const estimatedSlippage = notionalValue * input.estimatedSlippageRate;
    const maxLossEstimate = Math.abs(input.request.price - input.request.stopLoss) * input.request.units
      + estimatedSpreadCost + estimatedCommission + estimatedSlippage;
    const riskPct = input.accountEquity > 0 ? maxLossEstimate / input.accountEquity * 100 : 100;
    const id = randomUUID();
    const createdAt = now.toISOString();
    const riskSummary = {
      previewId: id,
      instrument: instrument.symbol,
      side: input.request.side,
      orderType: input.request.type,
      quantity: input.request.units,
      maxLossEstimate: round(maxLossEstimate),
      riskPct: round(riskPct),
      accountEquity: round(input.accountEquity),
      stopLoss: input.request.stopLoss,
    };
    const preview = {
      id,
      strategyId: input.request.strategyId,
      correlationId: input.request.correlationId,
      provider: input.provider,
      environment: input.environment,
      instrument: instrument.symbol,
      side: input.request.side,
      orderType: input.request.type,
      quantity: input.request.units,
      notionalValue: round(notionalValue),
      estimatedMargin: round(estimatedMargin),
      estimatedSpreadCost: round(estimatedSpreadCost),
      estimatedCommission: round(estimatedCommission),
      estimatedSlippage: round(estimatedSlippage),
      stopLoss: input.request.stopLoss,
      takeProfit: input.request.takeProfit ?? null,
      maxLossEstimate: round(maxLossEstimate),
      portfolioImpact: {
        currentExposure: round(input.currentPortfolioExposure),
        proposedExposure: round(input.currentPortfolioExposure + notionalValue),
        incrementalNotional: round(notionalValue),
      },
      riskAsPctOfAccount: round(riskPct),
      invalidationRule: input.invalidationRule,
      confirmationText: "I understand this is a live trade and I accept the risk.",
      riskSummaryHash: hash(riskSummary),
      createdAt,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      submissionAllowed: false as const,
      productionLiveSubmissionAllowed: false as const,
    };
    executionAuditLog.append({
      action: "live.order_preview",
      outcome: "created",
      correlationId: input.request.correlationId,
      detail: {
        previewId: id,
        provider: input.provider,
        environment: input.environment,
        instrument: instrument.symbol,
        riskSummaryHash: preview.riskSummaryHash,
      },
    });
    return preview;
  }
}

export function hashRiskSummary(value: Record<string, unknown>) {
  return hash(value);
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const orderPreviewService = new OrderPreviewService();
