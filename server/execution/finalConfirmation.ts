import { randomUUID } from "crypto";
import { executionAuditLog } from "./riskControls";

export const LIVE_CONFIRMATION_PHRASE = "I understand this is a live trade and I accept the risk.";

export type FinalConfirmationInput = {
  orderPreviewId: string;
  previewExpiresAt: string;
  userId: string;
  brokerAccountId: string;
  riskSummaryHash: string;
  expectedRiskSummaryHash: string;
  confirmationPhrase: string;
  currentTimestamp: string;
};

export class FinalConfirmationService {
  confirm(input: FinalConfirmationInput, now = new Date()) {
    const timestamp = Date.parse(input.currentTimestamp);
    const reasons = [
      !input.orderPreviewId ? "Order preview ID is required" : null,
      !input.userId ? "User ID is required" : null,
      !input.brokerAccountId ? "Broker account ID is required" : null,
      input.confirmationPhrase !== LIVE_CONFIRMATION_PHRASE ? "Confirmation phrase does not match exactly" : null,
      input.riskSummaryHash !== input.expectedRiskSummaryHash ? "Risk summary hash does not match the preview" : null,
      !Number.isFinite(timestamp) ? "Current timestamp is invalid" : null,
      Number.isFinite(timestamp) && Math.abs(now.getTime() - timestamp) > 60_000 ? "Confirmation timestamp is not current" : null,
      Date.parse(input.previewExpiresAt) < now.getTime() ? "Order preview has expired" : null,
    ].filter((reason): reason is string => Boolean(reason));
    const confirmation = {
      id: randomUUID(),
      accepted: reasons.length === 0,
      reasons,
      orderPreviewId: input.orderPreviewId,
      userId: input.userId,
      brokerAccountId: input.brokerAccountId,
      riskSummaryHash: input.riskSummaryHash,
      confirmedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      singleUse: true as const,
      productionLiveSubmissionAllowed: false as const,
    };
    executionAuditLog.append({
      action: "live.final_confirmation",
      outcome: confirmation.accepted ? "accepted" : "rejected",
      correlationId: input.orderPreviewId || randomUUID(),
      detail: {
        confirmationId: confirmation.id,
        orderPreviewId: input.orderPreviewId,
        userId: input.userId,
        brokerAccountId: input.brokerAccountId,
        riskSummaryHash: input.riskSummaryHash,
        reasons,
      },
    });
    return confirmation;
  }
}

export const finalConfirmationService = new FinalConfirmationService();
