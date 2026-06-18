import type { MarketPilotOverview, OrderPreview, TradeTicket } from "@shared/schema";
import { randomUUID } from "crypto";

export class BrokerPreviewService {
  createOrderPreview({
    ticket,
    overview,
    now = new Date(),
  }: {
    ticket: TradeTicket;
    overview: MarketPilotOverview;
    now?: Date;
  }): OrderPreview {
    if (ticket.riskCheck.decision !== "approve" || ticket.status !== "proposed") {
      throw Object.assign(new Error("Only risk-approved proposed tickets can receive an order preview"), {
        status: 409,
      });
    }

    const estimatedNotional = roundCurrency(ticket.quantity * ticket.entryPrice);
    const estimatedFees = roundCurrency(Math.max(0.01, ticket.quantity * 0.005));
    const estimatedSlippage = roundCurrency(estimatedNotional * 0.0005);
    const estimatedTotalCost = roundCurrency(
      ticket.direction === "buy" || ticket.direction === "cover"
        ? estimatedNotional + estimatedFees + estimatedSlippage
        : estimatedFees + estimatedSlippage,
    );
    const marginRequirement = 0;
    const buyingPowerImpact = ticket.direction === "buy" || ticket.direction === "cover" ? estimatedTotalCost : 0;
    const liquidityCheck = buyingPowerImpact > overview.portfolio.cash
      ? "fail"
      : buyingPowerImpact > overview.portfolio.cash * 0.8
        ? "warning"
        : "pass";
    const warnings = [
      "Live execution is disabled; this preview is paper-only.",
      "Estimated fees and slippage are educational approximations.",
      liquidityCheck === "fail" ? "Estimated buying-power impact exceeds paper cash." : null,
      liquidityCheck === "warning" ? "Estimated buying-power impact uses most available paper cash." : null,
    ].filter((item): item is string => Boolean(item));

    return {
      id: randomUUID(),
      tradeTicketId: ticket.id,
      broker: "marketpilot_paper_broker",
      environment: "paper",
      estimatedNotional,
      estimatedFees,
      estimatedSlippage,
      estimatedTotalCost,
      buyingPowerImpact: roundCurrency(buyingPowerImpact),
      marginRequirement,
      liquidityCheck,
      liveExecutionBlocked: true,
      complianceAcknowledgementRequired: true,
      warnings,
      approvalSteps: [
        "Risk Officer approval confirmed",
        "Verification evidence reviewed",
        "Paper broker preview generated",
        "User must acknowledge that this is not investment advice",
        "User must confirm final paper fill",
      ],
      createdAt: now.toISOString(),
    };
  }
}

export const brokerPreviewService = new BrokerPreviewService();

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}
