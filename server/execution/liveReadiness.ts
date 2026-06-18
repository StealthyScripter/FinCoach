export type LiveReadinessInput = {
  brokerConnected: boolean;
  accountSynced: boolean;
  credentialsEncrypted: boolean;
  mfaAcknowledged: boolean;
  proficiencyGatesPassed: boolean;
  liveRiskLimitsConfigured: boolean;
  dailyLossLimitConfigured: boolean;
  maxTradeSizeConfigured: boolean;
  killSwitchEnabled: boolean;
  complianceDisclosureAcknowledged: boolean;
};

export function evaluateLiveReadiness(input: LiveReadinessInput) {
  const checks = Object.entries(input).map(([id, passed]) => ({
    id,
    passed,
    detail: passed ? "Requirement satisfied" : requirementLabel(id),
  }));
  const readyForOrderPreview = checks.every((check) => check.passed);
  return {
    readyForOrderPreview,
    liveOrderSubmissionAllowed: false as const,
    explicitUserConfirmationRequired: true as const,
    checks,
    requiredActions: checks.filter((check) => !check.passed).map((check) => check.detail),
    orderFlow: ["strategy idea", "verification", "risk check", "order preview", "explicit user confirmation", "broker submission", "fill tracking", "journal entry"],
  };
}
function requirementLabel(id: string) {
  const labels: Record<string, string> = {
    brokerConnected: "Connect an approved broker",
    accountSynced: "Synchronize the broker account",
    credentialsEncrypted: "Store credentials in an approved encrypted vault",
    mfaAcknowledged: "Acknowledge and verify MFA/security controls",
    proficiencyGatesPassed: "Pass required trading proficiency gates",
    liveRiskLimitsConfigured: "Configure live risk limits",
    dailyLossLimitConfigured: "Configure a daily loss limit",
    maxTradeSizeConfigured: "Configure a maximum trade size",
    killSwitchEnabled: "Enable and test the global kill switch",
    complianceDisclosureAcknowledged: "Acknowledge the compliance disclosure",
  };
  return labels[id] ?? id;
}
