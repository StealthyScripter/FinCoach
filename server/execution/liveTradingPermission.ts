import type { StrategyValidationVerdict } from "./strategyValidation";
import { randomUUID } from "crypto";
import { executionAuditLog } from "./riskControls";
import { executionEmergencyState } from "./emergencyControls";

export type LiveTradingPermissionInput = {
  userId: string;
  proficiencyScore: number;
  requiredProficiencyScore: number;
  complianceDisclosureAcknowledged: boolean;
  accountRiskProfileCompleted: boolean;
  brokerConnectionVerified: boolean;
  accountMode: "paper" | "sandbox" | "live";
  expectedAccountMode: "sandbox" | "live";
  maxDailyLossConfigured: boolean;
  maxTradeRiskConfigured: boolean;
  killSwitchArmed: boolean;
  killSwitchTriggered: boolean;
  strategyValidationVerdict: StrategyValidationVerdict;
  liveSafetyQuizPassed: boolean;
  emergencyClosePolicyAccepted: boolean;
  brokerCredentialsEncrypted: boolean;
  sessionMfaVerified?: boolean;
};

export class LiveTradingPermissionService {
  blockedDefault(userId: string, now = new Date()) {
    return {
      userId,
      allowed: false,
      blocked: true,
      missingRequirements: ["Complete all controlled-live permission gates"],
      warnings: ["Permission does not authorize autonomous order placement"],
      requirements: [],
      issuedAt: now.toISOString(),
      expirationTimestamp: now.toISOString(),
      productionLiveSubmissionAllowed: false as const,
      explicitConfirmationRequired: true as const,
    };
  }

  evaluate(input: LiveTradingPermissionInput, now = new Date()) {
    const requirements = [
      gate("proficiency", input.proficiencyScore >= input.requiredProficiencyScore, `Reach proficiency score ${input.requiredProficiencyScore}`),
      gate("compliance", input.complianceDisclosureAcknowledged, "Acknowledge the current compliance disclosure"),
      gate("risk_profile", input.accountRiskProfileCompleted, "Complete the account risk profile"),
      gate("broker_connection", input.brokerConnectionVerified, "Verify the broker connection"),
      gate("account_mode", input.accountMode === input.expectedAccountMode, `Verify the account is in ${input.expectedAccountMode} mode`),
      gate("daily_loss", input.maxDailyLossConfigured, "Configure a maximum daily loss"),
      gate("trade_risk", input.maxTradeRiskConfigured, "Configure maximum risk per trade"),
      gate("kill_switch_armed", input.killSwitchArmed && !input.killSwitchTriggered, "Arm and test the kill switch"),
      gate("strategy_validation", input.strategyValidationVerdict === "supervised_live_candidate", "Validate the strategy as a supervised-live candidate"),
      gate("safety_quiz", input.liveSafetyQuizPassed, "Pass the live trading safety quiz"),
      gate("emergency_policy", input.emergencyClosePolicyAccepted, "Accept the emergency close policy"),
      gate("encrypted_credentials", input.brokerCredentialsEncrypted, "Store broker credentials in an approved encrypted vault"),
      gate("emergency_revocation", !executionEmergencyState.livePermissionRevoked, "Resolve the emergency live-permission revocation through administrative review"),
    ];
    const missingRequirements = requirements.filter((item) => !item.passed).map((item) => item.requiredAction);
    const warnings = [
      input.sessionMfaVerified === false ? "MFA must be reverified before final confirmation" : null,
      input.expectedAccountMode === "live" ? "Production order placement remains disabled by the application feature boundary" : null,
      "Permission does not authorize autonomous order placement",
    ].filter((item): item is string => Boolean(item));
    const allowed = missingRequirements.length === 0;
    const permission = {
      userId: input.userId,
      allowed,
      blocked: !allowed,
      missingRequirements,
      warnings,
      requirements,
      issuedAt: now.toISOString(),
      expirationTimestamp: allowed ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : now.toISOString(),
      productionLiveSubmissionAllowed: false as const,
      explicitConfirmationRequired: true as const,
    };
    executionAuditLog.append({
      action: "live.permission.evaluate",
      outcome: allowed ? "accepted" : "blocked",
      correlationId: randomUUID(),
      detail: { userId: input.userId, allowed, missingRequirements, expirationTimestamp: permission.expirationTimestamp },
    });
    return permission;
  }
}

function gate(id: string, passed: boolean, requiredAction: string) {
  return { id, passed, requiredAction };
}

export const liveTradingPermissionService = new LiveTradingPermissionService();
