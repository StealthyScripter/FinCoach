import type { LiveTradingPermissionService } from "./liveTradingPermission";

type Permission = ReturnType<LiveTradingPermissionService["evaluate"]>;

export type LiveReadinessReportInput = {
  permission: Permission;
  strategyReady: boolean;
  brokerReady: boolean;
  riskPrecheckApproved: boolean;
  riskLimitsConfigured: boolean;
  credentialsEncrypted: boolean;
  mfaVerified: boolean;
  complianceReady: boolean;
  auditTrailComplete: boolean;
  orderPreviewReady: boolean;
  finalConfirmationReady: boolean;
  killSwitchArmed: boolean;
  sandboxSubmitAvailable: boolean;
  productionFeatureEnabled: boolean;
};

export class LiveReadinessReportService {
  generate(input: LiveReadinessReportInput, now = new Date()) {
    const sections = {
      userReadiness: section([
        check("permission", input.permission.allowed, "Complete live trading permission gates"),
      ]),
      strategyReadiness: section([
        check("strategy_validation", input.strategyReady, "Validate the selected strategy for supervised live candidacy"),
      ]),
      brokerReadiness: section([
        check("broker_connection", input.brokerReady, "Verify the broker connection and account mode"),
        check("sandbox_submit", input.sandboxSubmitAvailable, "Configure a sandbox-capable broker adapter"),
      ]),
      riskReadiness: section([
        check("risk_limits", input.riskLimitsConfigured, "Configure daily-loss and per-trade risk limits"),
        check("risk_precheck", input.riskPrecheckApproved, "Resolve the current execution risk precheck"),
        check("kill_switch", input.killSwitchArmed, "Arm and test the kill switch"),
      ]),
      securityReadiness: section([
        check("encrypted_credentials", input.credentialsEncrypted, "Use an approved encrypted credential vault"),
        check("mfa", input.mfaVerified, "Verify MFA for the current broker session"),
      ]),
      complianceReadiness: section([
        check("compliance", input.complianceReady, "Complete compliance acknowledgements"),
        check("final_confirmation", input.finalConfirmationReady, "Complete a current preview-bound final confirmation"),
      ]),
      systemReadiness: section([
        check("audit_trail", input.auditTrailComplete, "Verify the complete immutable audit trail"),
        check("order_preview", input.orderPreviewReady, "Generate and verify the current order preview"),
      ]),
    };
    const missingRequirements = Object.values(sections).flatMap((value) => value.missingRequirements);
    let verdict: "blocked" | "sandbox_only" | "supervised_live_ready" = "blocked";
    if (missingRequirements.length === 0) {
      verdict = input.productionFeatureEnabled ? "supervised_live_ready" : "sandbox_only";
    }
    return {
      verdict,
      sections,
      missingRequirements,
      nextRequiredAction: missingRequirements[0] ?? (
        verdict === "sandbox_only"
          ? "Complete independent production security and compliance approval before enabling the production feature flag"
          : "Require explicit per-order user confirmation"
      ),
      productionLiveSubmissionAllowed: false as const,
      autonomousLiveTradingAllowed: false as const,
      generatedAt: now.toISOString(),
    };
  }
}

function check(id: string, passed: boolean, requiredAction: string) {
  return { id, passed, requiredAction };
}

function section(checks: Array<ReturnType<typeof check>>) {
  return {
    ready: checks.every((item) => item.passed),
    checks,
    missingRequirements: checks.filter((item) => !item.passed).map((item) => item.requiredAction),
  };
}

export const liveReadinessReportService = new LiveReadinessReportService();
