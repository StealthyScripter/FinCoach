import type { BrokerReadiness, BrokerReadinessCheck, MarketPilotOverview } from "@shared/schema";

type VaultProvider = BrokerReadiness["vault"]["provider"];

type BrokerReadinessOptions = {
  vaultProvider?: VaultProvider;
  credentialsStored?: boolean;
  mfaVerified?: boolean;
  deviceVerified?: boolean;
  sessionFresh?: boolean;
  adminUnlock?: boolean;
  userUnlock?: boolean;
  now?: Date;
};

export class BrokerReadinessService {
  evaluate(
    overview: MarketPilotOverview,
    {
      vaultProvider = "not_configured",
      credentialsStored = false,
      mfaVerified = false,
      deviceVerified = false,
      sessionFresh = false,
      adminUnlock = false,
      userUnlock = false,
      now = new Date(),
    }: BrokerReadinessOptions = {},
  ): BrokerReadiness[] {
    return [
      this.paperBrokerReadiness(now),
      this.interactiveBrokersReadiness(overview, {
        vaultProvider,
        credentialsStored,
        mfaVerified,
        deviceVerified,
        sessionFresh,
        adminUnlock,
        userUnlock,
        now,
      }),
    ];
  }

  private paperBrokerReadiness(now: Date): BrokerReadiness {
    return {
      broker: "paper_broker",
      connectionStatus: "paper_ready",
      liveExecutionAllowed: false,
      paperOnly: true,
      checks: [
        pass("paper_environment", "Paper environment", "Paper trading is available without broker credentials."),
        pass("audit_logging", "Audit logging", "Paper previews, fills, and journal entries are logged."),
        pass("live_block", "Live execution block", "Paper broker cannot route real orders."),
      ],
      requiredActions: [],
      vault: {
        provider: "not_configured",
        credentialsStored: false,
        rotationRequired: false,
      },
      readOnlyRequired: true,
      mfaRequired: false,
      deviceVerificationRequired: false,
      sessionTimeoutMinutes: 30,
      generatedAt: now.toISOString(),
    };
  }

  private interactiveBrokersReadiness(
    overview: MarketPilotOverview,
    {
      vaultProvider,
      credentialsStored,
      mfaVerified,
      deviceVerified,
      sessionFresh,
      adminUnlock,
      userUnlock,
      now,
    }: Required<BrokerReadinessOptions>,
  ): BrokerReadiness {
    const supervisedLiveStage = overview.progression.currentStage === "supervised_live";
    const liveFeatureEnabled = overview.user.liveTradingEnabled;
    const checks: BrokerReadinessCheck[] = [
      liveFeatureEnabled
        ? pass("live_feature", "Live trading feature", "Live trading has been enabled for this account.")
        : fail("live_feature", "Live trading feature", "Live trading is disabled for this account.", "Complete legal, compliance, and administrator approval."),
      supervisedLiveStage
        ? pass("proficiency_stage", "Proficiency gate", "User is in Supervised Live Assistance Mode.")
        : fail("proficiency_stage", "Proficiency gate", "User has not unlocked Supervised Live Assistance Mode.", "Pass the required proficiency, margin, options, and risk discipline gates."),
      vaultProvider !== "not_configured" && credentialsStored
        ? pass("credential_vault", "Credential vault", "Broker credentials are stored outside the application database.")
        : fail("credential_vault", "Credential vault", "No approved external vault is configured for broker credentials.", "Configure a supported secret vault and rotate credentials before connecting a broker."),
      mfaVerified
        ? pass("mfa", "Multi-factor authentication", "MFA has been verified for the current broker session.")
        : fail("mfa", "Multi-factor authentication", "MFA is required before any broker connection can be considered ready.", "Verify MFA for the broker connection."),
      deviceVerified
        ? pass("device", "Device verification", "Current device has been verified.")
        : fail("device", "Device verification", "This device has not been approved for live broker access.", "Verify this device before broker access."),
      sessionFresh
        ? pass("session", "Session freshness", "Session age is within the broker approval window.")
        : fail("session", "Session freshness", "Broker approval requires a fresh authenticated session.", "Re-authenticate before broker preview or live order review."),
      adminUnlock
        ? pass("admin_unlock", "Administrator unlock", "Administrative live-trading unlock is present.")
        : fail("admin_unlock", "Administrator unlock", "Administrative live-trading unlock is absent.", "Obtain internal approval after compliance review."),
      userUnlock
        ? pass("user_unlock", "User unlock", "User has explicitly requested live supervised assistance.")
        : fail("user_unlock", "User unlock", "User has not explicitly unlocked supervised live assistance.", "Complete user acknowledgement and live-risk disclosure."),
      pass("read_only_default", "Read-only default", "Broker readiness starts in read-only mode until order preview approval."),
      pass("audit_logging", "Audit logging", "Broker readiness checks are designed for audit logging before execution."),
    ];

    const requiredActions = checks
      .filter((check) => check.status === "fail" && check.requiredAction)
      .map((check) => check.requiredAction as string);
    const liveExecutionAllowed = requiredActions.length === 0;

    return {
      broker: "interactive_brokers",
      connectionStatus: liveExecutionAllowed ? "read_only_ready" : "blocked",
      liveExecutionAllowed,
      paperOnly: true,
      checks,
      requiredActions,
      vault: {
        provider: vaultProvider,
        credentialsStored,
        rotationRequired: vaultProvider === "not_configured" || !credentialsStored,
      },
      readOnlyRequired: true,
      mfaRequired: true,
      deviceVerificationRequired: true,
      sessionTimeoutMinutes: 15,
      generatedAt: now.toISOString(),
    };
  }
}

export const brokerReadinessService = new BrokerReadinessService();

function pass(id: string, label: string, detail: string): BrokerReadinessCheck {
  return { id, label, status: "pass", detail };
}

function fail(id: string, label: string, detail: string, requiredAction: string): BrokerReadinessCheck {
  return { id, label, status: "fail", detail, requiredAction };
}
