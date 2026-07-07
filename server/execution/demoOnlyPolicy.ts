import { randomUUID } from "crypto";
import { eventLogService } from "../eventLogService";
import { executionAuditLog } from "./riskControls";

export const ALLOWED_DEMO_ACCOUNT_MODES = ["demo", "paper", "sandbox", "practice", "simulated"] as const;
export const BLOCKED_ACCOUNT_MODES = ["live", "real", "production", "margin_live", "cash_live", "unknown", "unverified"] as const;

export type DemoAccountMode = typeof ALLOWED_DEMO_ACCOUNT_MODES[number];
export type BlockedAccountMode = typeof BLOCKED_ACCOUNT_MODES[number];
export type AccountMode = DemoAccountMode | BlockedAccountMode | (string & {});

export type DemoOnlyPolicyCheckInput = {
  provider: string;
  accountMode: AccountMode | null | undefined;
  verificationSource: string;
  attemptedAction: string;
  actor?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type DemoOnlyPolicyResult = {
  allowed: boolean;
  blocked: boolean;
  reason: string;
  accountMode: AccountMode;
  provider: string;
  verificationSource: string;
  timestamp: string;
};

const LIVE_ENV_KEYS = [
  "OANDA_ENV",
  "BROKER_ENV",
  "METATRADER_ENV",
  "EXECUTION_MODE",
  "MARKETPILOT_ALLOW_LIVE_EXECUTION",
  "MARKETPILOT_ENABLE_LIVE_TRADING",
  "MARKETPILOT_PRODUCTION_LIVE_EXECUTION",
  "ENABLE_LIVE_TRADING",
  "LIVE_TRADING_ENABLED",
] as const;

const LIVE_ENV_VALUE = /^(live|real|production|prod|margin_live|cash_live|true|1|yes|enabled|on)$/i;
const UNSUPPORTED_PROVIDERS = new Set(["robinhood_stub", "cash_app_stub", "generic_rest_broker", "generic_rest_sandbox"]);
const SUPPORTED_PROVIDERS = new Set([
  "analysis_tools",
  "controlled_live_workflow",
  "demo_provider",
  "fred",
  "metatrader_demo",
  "oanda_practice",
  "oanda_sandbox",
  "paper_provider",
  "telegram",
  "telegram_notifications",
  "tradingview_webhook",
]);

export class DemoOnlyPolicyService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  isDemoOnlyEnabled() {
    return this.env.MARKETPILOT_DEMO_ONLY?.trim().toLowerCase() !== "false";
  }

  check(input: DemoOnlyPolicyCheckInput): DemoOnlyPolicyResult {
    const timestamp = (input.now ?? new Date()).toISOString();
    const provider = normalize(input.provider) || "unknown";
    const accountMode = normalize(input.accountMode ?? "unknown") as AccountMode;
    const verificationSource = input.verificationSource.trim() || "unverified";

    const liveEnv = this.liveEnvironmentViolations();
    const reason = !this.isDemoOnlyEnabled()
      ? "MarketPilot demo-only mode cannot be disabled."
      : liveEnv.length > 0
        ? `Live execution configuration is not allowed: ${liveEnv.join(", ")}.`
        : UNSUPPORTED_PROVIDERS.has(provider)
          ? "Provider is not supported for demo-only execution."
          : !SUPPORTED_PROVIDERS.has(provider)
            ? "Provider is not supported for demo-only execution."
          : !ALLOWED_DEMO_ACCOUNT_MODES.includes(accountMode as DemoAccountMode)
            ? accountMode === "unknown" || accountMode === "unverified"
              ? "Account mode is unverified; execution is blocked."
              : `Account mode ${accountMode} is not allowed in demo-only mode.`
            : verificationSource === "unverified"
              ? "Account mode verification source is unverified."
              : "";

    return {
      allowed: reason.length === 0,
      blocked: reason.length > 0,
      reason: reason || "Account mode verified for demo-only execution.",
      accountMode,
      provider,
      verificationSource,
      timestamp,
    };
  }

  assertAllowed(input: DemoOnlyPolicyCheckInput): DemoOnlyPolicyResult {
    const result = this.check(input);
    if (result.blocked) {
      this.recordBlocked(input, result);
      throw new DemoOnlyPolicyError(result);
    }
    return result;
  }

  recordBlocked(input: DemoOnlyPolicyCheckInput, result = this.check(input)) {
    const correlationId = randomUUID();
    const detail = {
      provider: result.provider,
      accountMode: result.accountMode,
      attemptedAction: input.attemptedAction,
      blockReason: result.reason,
      actor: input.actor ?? "system",
      source: input.source ?? "demo-only-policy",
      verificationSource: result.verificationSource,
      timestamp: result.timestamp,
      demoOnly: true,
      ...(input.metadata ?? {}),
    };
    executionAuditLog.append({
      action: "demo_only.execution_blocked",
      outcome: "blocked",
      correlationId,
      detail,
    });
    eventLogService.append({
      type: "connector.action_requested",
      userId: input.actor ?? "system",
      sourceService: input.source ?? "demo-only-policy",
      correlationId,
      payload: detail,
      createdAt: result.timestamp,
    });
  }

  validateEnvironment() {
    const violations = this.liveEnvironmentViolations();
    return {
      safe: this.isDemoOnlyEnabled() && violations.length === 0,
      demoOnlyEnabled: this.isDemoOnlyEnabled(),
      violations,
    };
  }

  private liveEnvironmentViolations() {
    const violations: string[] = [];
    if (!this.isDemoOnlyEnabled()) violations.push("MARKETPILOT_DEMO_ONLY=false");
    for (const key of LIVE_ENV_KEYS) {
      const value = this.env[key]?.trim();
      if (!value) continue;
      if (key === "OANDA_ENV" && value.toLowerCase() === "practice") continue;
      if (key === "METATRADER_ENV" && ["demo", "sandbox", "paper", "practice", "simulated"].includes(value.toLowerCase())) continue;
      if (LIVE_ENV_VALUE.test(value)) violations.push(`${key}=${redactValue(key, value)}`);
    }
    if (this.env.METATRADER_LIVE_BRIDGE_URL?.trim()) violations.push("METATRADER_LIVE_BRIDGE_URL=configured");
    return violations;
  }
}

export class DemoOnlyPolicyError extends Error {
  constructor(readonly result: DemoOnlyPolicyResult) {
    super(`Blocked: ${result.reason}`);
    this.name = "DemoOnlyPolicyError";
  }
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function redactValue(key: string, value: string) {
  return /token|secret|password|key/i.test(key) ? "[REDACTED]" : value;
}

export const demoOnlyPolicyService = new DemoOnlyPolicyService();
