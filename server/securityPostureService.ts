import type {
  BrokerReadiness,
  LiveAssistancePolicy,
  MarketPilotOverview,
  SecurityControl,
  SecurityPostureReport,
} from "@shared/schema";

export class SecurityPostureService {
  evaluate({
    overview,
    brokerReadiness,
    livePolicy,
    rateLimiterEnabled = false,
    now = new Date(),
  }: {
    overview: MarketPilotOverview;
    brokerReadiness: BrokerReadiness[];
    livePolicy: LiveAssistancePolicy;
    rateLimiterEnabled?: boolean;
    now?: Date;
  }): SecurityPostureReport {
    const ibkr = brokerReadiness.find((item) => item.broker === "interactive_brokers");
    const paper = brokerReadiness.find((item) => item.broker === "paper_broker");
    const controls: SecurityControl[] = [
      control({
        id: "mfa",
        label: "Multi-factor authentication",
        status: ibkr?.mfaRequired ? "warning" : "fail",
        evidence: [
          `Interactive Brokers MFA required: ${ibkr?.mfaRequired ? "yes" : "no"}.`,
          "Current readiness model requires MFA before broker access, but no identity provider integration is present yet.",
        ],
        requiredActions: ["Integrate identity-service MFA verification before live broker workflows."],
      }),
      control({
        id: "credential_vault",
        label: "Credential vault",
        status: ibkr?.vault.provider !== "not_configured" && ibkr?.vault.credentialsStored ? "pass" : "fail",
        evidence: [
          `Vault provider: ${ibkr?.vault.provider ?? "missing"}.`,
          `Credentials stored: ${ibkr?.vault.credentialsStored ? "yes" : "no"}.`,
        ],
        requiredActions: ibkr?.vault.provider !== "not_configured" && ibkr?.vault.credentialsStored
          ? []
          : ["Configure external vault storage before any real broker credential is accepted."],
      }),
      control({
        id: "rbac",
        label: "Role-based permissions",
        status: "warning",
        evidence: [
          "Routes are currently single-demo-user oriented.",
          "Compliance and risk gates exist, but role-based authorization is not enforced at route level.",
        ],
        requiredActions: ["Add identity-service roles and route-level authorization before multi-user production use."],
      }),
      control({
        id: "session_timeout",
        label: "Session timeout",
        status: ibkr?.sessionTimeoutMinutes ? "warning" : "fail",
        evidence: [`Broker session timeout target: ${ibkr?.sessionTimeoutMinutes ?? "missing"} minutes.`],
        requiredActions: ["Enforce server-side session freshness for broker preview and approval actions."],
      }),
      control({
        id: "device_verification",
        label: "Device verification",
        status: ibkr?.deviceVerificationRequired ? "warning" : "fail",
        evidence: [`Device verification required: ${ibkr?.deviceVerificationRequired ? "yes" : "no"}.`],
        requiredActions: ["Persist trusted-device approvals before enabling live broker access."],
      }),
      control({
        id: "audit_logs",
        label: "Audit logs",
        status: overview.auditLogs.length > 0 ? "pass" : "warning",
        evidence: [`${overview.auditLogs.length} audit event(s) present in the current overview.`],
        requiredActions: overview.auditLogs.length > 0
          ? []
          : ["Persist immutable audit events for all approval and execution-boundary actions."],
      }),
      control({
        id: "rate_limits",
        label: "Rate limits",
        status: rateLimiterEnabled ? "warning" : "fail",
        evidence: [
          rateLimiterEnabled
            ? "In-memory API rate limiter is mounted for the current Express process."
            : "No route-level rate limiter is configured in the current Express app.",
          "Redis-backed shared counters are still required before multi-replica deployment.",
        ],
        requiredActions: rateLimiterEnabled
          ? ["Promote rate limiting to Redis before horizontal scaling."]
          : ["Add API rate limiting before public or multi-user deployment."],
      }),
      control({
        id: "environment_separation",
        label: "Environment separation",
        status: livePolicy.canPlaceLiveOrder ? "fail" : "pass",
        evidence: [
          `Live policy can place live order: ${livePolicy.canPlaceLiveOrder ? "yes" : "no"}.`,
          `User live trading enabled: ${overview.user.liveTradingEnabled ? "yes" : "no"}.`,
        ],
        requiredActions: livePolicy.canPlaceLiveOrder
          ? ["Verify production live-trading isolation before enabling any order placement."]
          : [],
      }),
      control({
        id: "paper_live_separation",
        label: "Paper/live account separation",
        status: paper?.paperOnly && ibkr?.paperOnly ? "pass" : "warning",
        evidence: [
          `Paper broker paper-only: ${paper?.paperOnly ? "yes" : "no"}.`,
          `Interactive Brokers readiness paper-only flag: ${ibkr?.paperOnly ? "yes" : "no"}.`,
        ],
        requiredActions: paper?.paperOnly && ibkr?.paperOnly
          ? []
          : ["Keep paper and live account environments physically separated."],
      }),
    ];
    const score = Math.round(controls.reduce((sum, item) => sum + scoreControl(item), 0) / controls.length);
    const requiredActions = unique(controls.flatMap((item) => item.requiredActions));

    return {
      id: "security-posture-current",
      generatedAt: now.toISOString(),
      status: score >= 85 ? "pass" : score >= 60 ? "warning" : "fail",
      score,
      controls,
      requiredActions,
      liveExecutionBlocked: !livePolicy.canPlaceLiveOrder,
    };
  }
}

export const securityPostureService = new SecurityPostureService();

function control(control: SecurityControl): SecurityControl {
  return control;
}

function scoreControl(control: SecurityControl) {
  switch (control.status) {
    case "pass":
      return 100;
    case "warning":
      return 60;
    case "fail":
      return 20;
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
