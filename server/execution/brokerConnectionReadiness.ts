export type BrokerConnectionReadinessInput = {
  provider: string;
  credentialsConfigured: boolean;
  credentialsEncrypted: boolean;
  providerReachable: boolean;
  accountMode: "paper" | "live";
  expectedEnvironment: "paper" | "live";
  marginAvailable: number;
  minimumMarginRequired: number;
  permissions: string[];
  requiredPermissions: string[];
  supportedInstruments: string[];
  requiredInstruments: string[];
  rateLimitRemaining: number;
  minimumRateLimitRemaining: number;
  lastSyncAt: string | null;
  maxSyncAgeSeconds: number;
  emergencyDisconnectAvailable: boolean;
};

export class BrokerConnectionReadinessService {
  evaluate(input: BrokerConnectionReadinessInput, now = new Date()) {
    const syncAgeSeconds = input.lastSyncAt
      ? Math.max(0, (now.getTime() - Date.parse(input.lastSyncAt)) / 1000)
      : Number.POSITIVE_INFINITY;
    const checks = [
      readiness("credentials_configured", input.credentialsConfigured, "Credentials are not configured"),
      readiness("credentials_encrypted", input.credentialsEncrypted, "Credentials must use encrypted storage"),
      readiness("provider_reachable", input.providerReachable, "Provider is unreachable"),
      readiness("account_mode", input.accountMode === input.expectedEnvironment, "Broker account mode does not match the configured environment"),
      readiness("margin_available", input.marginAvailable >= input.minimumMarginRequired, "Available margin is insufficient"),
      readiness("permissions", input.requiredPermissions.every((item) => input.permissions.includes(item)), "Required broker permissions are missing"),
      readiness("instruments", input.requiredInstruments.every((item) => input.supportedInstruments.includes(item)), "Required instruments are unsupported"),
      readiness("rate_limits", input.rateLimitRemaining >= input.minimumRateLimitRemaining, "Provider rate-limit headroom is insufficient"),
      readiness("last_sync", syncAgeSeconds <= input.maxSyncAgeSeconds, "Broker synchronization is stale"),
      readiness("emergency_disconnect", input.emergencyDisconnectAvailable, "Emergency disconnect is unavailable"),
    ];
    const ready = checks.every((check) => check.passed);
    return {
      provider: input.provider,
      accountMode: input.accountMode,
      readyForPaper: ready && input.accountMode === "paper",
      readyForSupervisedLivePreview: ready && input.accountMode === "live",
      liveOrderSubmissionAllowed: false as const,
      explicitUserConfirmationRequired: true as const,
      checks,
      blockingReasons: checks.filter((check) => !check.passed).map((check) => check.detail),
      syncAgeSeconds: Number.isFinite(syncAgeSeconds) ? Math.round(syncAgeSeconds) : null,
      checkedAt: now.toISOString(),
    };
  }
}

function readiness(id: string, passed: boolean, detail: string) {
  return { id, passed, detail: passed ? "Requirement satisfied" : detail };
}

export const brokerConnectionReadinessService = new BrokerConnectionReadinessService();
