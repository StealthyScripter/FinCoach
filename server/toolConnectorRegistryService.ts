import { executionAuditLog } from "./execution/riskControls";
import { demoOnlyPolicyService, type AccountMode } from "./execution/demoOnlyPolicy";

export type ConnectorType =
  | "broker"
  | "trading_platform"
  | "analysis_platform"
  | "payment_or_cash_app"
  | "data_provider"
  | "notification_provider";

export type ConnectorHealth = "healthy" | "degraded" | "disabled";

export type ToolConnectorReport = {
  id: string;
  name: string;
  type: ConnectorType;
  providerName: string;
  connectorType: ConnectorType;
  environmentLabel: string;
  supportedAssetClasses: string[];
  supportedCapabilities: string[];
  supportedActions: string[];
  disabledActions: string[];
  safetyConstraints: string[];
  costLevel: "internal" | "free" | "demo" | "low" | "paid";
  authMethod: string;
  environment: "disabled" | "demo" | "practice" | "paper" | "bridge" | "internal";
  health: ConnectorHealth;
  limitations: string[];
  liveExecutionSupport: boolean;
  liveCapabilityDisabledReason: string;
  sandboxSupport: boolean;
  accountMode: AccountMode;
  demoVerificationStatus: "verified" | "blocked" | "unverified";
  demoVerificationSource: string;
  executionAllowed: boolean;
  executionBlockedReason: string | null;
  lastAccountModeVerificationAt: string;
  enabled: boolean;
  configured: boolean;
  requiredEnvVars: string[];
  missingEnvVars: string[];
  lastCheckedAt: string;
  lastSyncAt: string | null;
  recentSignals?: number;
  signalQuality?: {
    accepted: number;
    reviewRequired: number;
    rejected: number;
  };
};

export type ToolConnectorRegistrySnapshot = {
  generatedAt: string;
  connectors: ToolConnectorReport[];
};

export class ToolConnectorRegistryService {
  snapshot(now = new Date()): ToolConnectorRegistrySnapshot {
    const lastCheckedAt = now.toISOString();
    const tradingViewSignals = executionAuditLog.list().filter((entry) => entry.action === "tradingview.signal");
    const tradingViewAccepted = tradingViewSignals.filter((entry) => entry.outcome === "accepted").length;
    const tradingViewRejected = tradingViewSignals.filter((entry) => entry.outcome === "rejected").length;
    const tradingViewReviewed = tradingViewSignals.filter((entry) => entry.outcome === "blocked").length;

    return {
      generatedAt: lastCheckedAt,
      connectors: [
        this.connector({
          id: "analysis_tools",
          name: "MarketPilot Internal Analysis Tools",
          type: "analysis_platform",
          providerName: "MarketPilot",
          connectorType: "analysis_platform",
          environmentLabel: "internal",
          supportedAssetClasses: ["equities", "etf", "forex", "commodities", "macro"],
          supportedCapabilities: ["moving_averages", "rsi", "macd", "atr", "bollinger_bands", "trend_classification", "session_filters", "spread_liquidity_checks"],
          supportedActions: ["indicator_calculation", "signal_support", "regime_classification"],
          disabledActions: ["order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Advisory only", "No external execution path"],
          costLevel: "internal",
          authMethod: "none",
          environment: "internal",
          health: "healthy",
          limitations: ["Indicator outputs remain advisory only."],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: true,
          requiredEnvVars: [],
          missingEnvVars: [],
          lastCheckedAt,
          lastSyncAt: lastCheckedAt,
        }),
        this.connector({
          id: "oanda_practice",
          name: "OANDA Practice Broker",
          type: "broker",
          providerName: "OANDA",
          connectorType: "broker",
          environmentLabel: "practice",
          supportedAssetClasses: ["forex", "commodities"],
          supportedCapabilities: ["practice_account_sync", "pricing", "order_preview", "sandbox_submit"],
          supportedActions: ["account_sync", "pricing", "order_preview", "sandbox_submit"],
          disabledActions: ["live_order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Practice mode only", "Live execution disabled by policy"],
          costLevel: "free",
          authMethod: "env:OANDA_API_TOKEN",
          environment: "practice",
          health: this.env.OANDA_API_TOKEN?.trim() && this.env.OANDA_ACCOUNT_ID?.trim()
            ? this.env.OANDA_ENV?.trim().toLowerCase() === "practice" ? "healthy" : "degraded"
            : "disabled",
          limitations: [
            "Live account order placement is disabled by MarketPilot demo-only policy.",
            "Only practice-mode workflows are supported.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: Boolean(this.env.OANDA_API_TOKEN?.trim() && this.env.OANDA_ACCOUNT_ID?.trim() && this.env.OANDA_ENV?.trim().toLowerCase() === "practice"),
          requiredEnvVars: ["OANDA_API_TOKEN", "OANDA_ACCOUNT_ID", "OANDA_ENV"],
          missingEnvVars: ["OANDA_API_TOKEN", "OANDA_ACCOUNT_ID", "OANDA_ENV"].filter((key) => !this.env[key]?.trim()),
          lastCheckedAt,
          lastSyncAt: this.env.OANDA_API_TOKEN?.trim() && this.env.OANDA_ACCOUNT_ID?.trim() ? lastCheckedAt : null,
        }),
        this.connector({
          id: "metatrader_demo",
          name: "MetaTrader 5 Demo Bridge",
          type: "trading_platform",
          providerName: "MetaTrader 5",
          connectorType: "trading_platform",
          environmentLabel: "bridge",
          supportedAssetClasses: ["forex", "commodities"],
          supportedCapabilities: ["bridge_health", "symbol_mapping", "demo_price_feed", "order_bridge_contract", "account_sync"],
          supportedActions: ["bridge_health", "symbol_mapping", "demo_price_feed", "order_bridge_contract", "account_sync"],
          disabledActions: ["live_order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Demo bridge only", "Bridge availability determines health"],
          costLevel: "demo",
          authMethod: "bridge_url",
          environment: "bridge",
          health: this.envConfigured(["METATRADER_DEMO_BRIDGE_URL"]),
          limitations: [
            "Only demo/bridge-mode workflows are supported.",
            "External bridge availability determines live health.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: Boolean(this.env.METATRADER_DEMO_BRIDGE_URL?.trim()),
          requiredEnvVars: ["METATRADER_DEMO_BRIDGE_URL"],
          missingEnvVars: ["METATRADER_DEMO_BRIDGE_URL"].filter((key) => !this.env[key]?.trim()),
          lastCheckedAt,
          lastSyncAt: this.env.METATRADER_DEMO_BRIDGE_URL?.trim() ? lastCheckedAt : null,
        }),
        this.connector({
          id: "tradingview_webhook",
          name: "TradingView Webhook Ingestion",
          type: "trading_platform",
          providerName: "TradingView",
          connectorType: "trading_platform",
          environmentLabel: this.env.TRADINGVIEW_WEBHOOK_SECRET?.trim() ? "bridge" : "disabled",
          supportedAssetClasses: ["forex", "commodities", "equities", "etf"],
          supportedCapabilities: ["webhook_ingestion", "signal_quality_stats", "strategy_mapping", "replay_protection"],
          supportedActions: ["webhook_ingestion", "signal_quality_stats", "strategy_mapping", "replay_protection"],
          disabledActions: ["order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Signals are advisory only", "Webhook secret rotation required if exposure is suspected"],
          costLevel: "free",
          authMethod: "webhook_secret",
          environment: this.env.TRADINGVIEW_WEBHOOK_SECRET?.trim() ? "bridge" : "disabled",
          health: this.env.TRADINGVIEW_WEBHOOK_SECRET?.trim() ? "healthy" : "disabled",
          limitations: [
            "Signals remain advisory and require verification.",
            "Webhook secret rotation is required if exposure is suspected.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: Boolean(this.env.TRADINGVIEW_WEBHOOK_SECRET?.trim()),
          requiredEnvVars: ["TRADINGVIEW_WEBHOOK_SECRET"],
          missingEnvVars: ["TRADINGVIEW_WEBHOOK_SECRET"].filter((key) => !this.env[key]?.trim()),
          lastCheckedAt,
          lastSyncAt: this.env.TRADINGVIEW_WEBHOOK_SECRET?.trim() ? lastCheckedAt : null,
          recentSignals: tradingViewSignals.length,
          signalQuality: {
            accepted: tradingViewAccepted,
            reviewRequired: tradingViewReviewed,
            rejected: tradingViewRejected,
          },
        }),
        this.connector({
          id: "telegram_notifications",
          name: "Telegram Notification Channel",
          type: "notification_provider",
          providerName: "Telegram",
          connectorType: "notification_provider",
          environmentLabel: this.env.TELEGRAM_BOT_TOKEN?.trim() ? "bridge" : "disabled",
          supportedAssetClasses: ["system", "alerts", "journal"],
          supportedCapabilities: ["status", "alerts", "digests", "confirmations", "kill_switch_control"],
          supportedActions: ["status", "alerts", "digests", "confirmations", "kill_switch_control"],
          disabledActions: ["live_order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Only the configured Telegram user may control the bot", "Risky actions require confirmation"],
          costLevel: "free",
          authMethod: "env:TELEGRAM_BOT_TOKEN",
          environment: this.env.TELEGRAM_BOT_TOKEN?.trim() ? "bridge" : "disabled",
          health: this.env.TELEGRAM_BOT_TOKEN?.trim() && this.telegramAllowedUserId() && this.env.TELEGRAM_WEBHOOK_SECRET?.trim() && this.env.TELEGRAM_WEBHOOK_URL?.trim() ? "healthy" : "disabled",
          limitations: [
            "Only the configured Telegram user may control the bot.",
            "Risky actions require confirmation.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: Boolean(this.env.TELEGRAM_BOT_TOKEN?.trim() && this.telegramAllowedUserId() && this.env.TELEGRAM_WEBHOOK_SECRET?.trim() && this.env.TELEGRAM_WEBHOOK_URL?.trim()),
          requiredEnvVars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_ID", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_URL"],
          missingEnvVars: [
            !this.env.TELEGRAM_BOT_TOKEN?.trim() ? "TELEGRAM_BOT_TOKEN" : null,
            !this.telegramAllowedUserId() ? "TELEGRAM_ALLOWED_USER_ID" : null,
            !this.env.TELEGRAM_WEBHOOK_SECRET?.trim() ? "TELEGRAM_WEBHOOK_SECRET" : null,
            !this.env.TELEGRAM_WEBHOOK_URL?.trim() ? "TELEGRAM_WEBHOOK_URL" : null,
          ].filter((key): key is string => Boolean(key)),
          lastCheckedAt,
          lastSyncAt: this.env.TELEGRAM_WEBHOOK_URL?.trim() ? lastCheckedAt : null,
        }),
        this.connector({
          id: "robinhood_stub",
          name: "Robinhood Connector Stub",
          type: "broker",
          providerName: "Robinhood",
          connectorType: "broker",
          environmentLabel: "disabled",
          supportedAssetClasses: [],
          supportedCapabilities: [],
          supportedActions: [],
          disabledActions: ["order_submission", "account_sync", "withdrawals", "transfers"],
          safetyConstraints: ["Disabled until an official API is verified", "No unofficial scraping or credential automation"],
          costLevel: "free",
          authMethod: "unsupported",
          environment: "disabled",
          health: "disabled",
          limitations: [
            "Unsupported until an official API is verified.",
            "No unofficial scraping or credential automation is allowed.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: false,
          configured: false,
          requiredEnvVars: [],
          missingEnvVars: [],
          lastCheckedAt,
          lastSyncAt: null,
        }),
        this.connector({
          id: "cash_app_stub",
          name: "Cash App Connector Stub",
          type: "payment_or_cash_app",
          providerName: "Cash App",
          connectorType: "payment_or_cash_app",
          environmentLabel: "disabled",
          supportedAssetClasses: [],
          supportedCapabilities: [],
          supportedActions: [],
          disabledActions: ["order_submission", "account_sync", "withdrawals", "transfers"],
          safetyConstraints: ["Disabled until an official API is verified", "No credential automation or scraping"],
          costLevel: "free",
          authMethod: "unsupported",
          environment: "disabled",
          health: "disabled",
          limitations: [
            "Portfolio/reference only until an official API is verified.",
            "No credential automation or scraping is allowed.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: false,
          configured: false,
          requiredEnvVars: [],
          missingEnvVars: [],
          lastCheckedAt,
          lastSyncAt: null,
        }),
        this.connector({
          id: "generic_rest_broker",
          name: "Generic REST Broker",
          type: "broker",
          providerName: "Generic REST Broker",
          connectorType: "broker",
          environmentLabel: this.env.GENERIC_REST_BROKER_BASE_URL?.trim() ? "bridge" : "disabled",
          supportedAssetClasses: ["forex", "equities", "etf", "commodities"],
          supportedCapabilities: ["demo_account_sync", "pricing", "order_preview", "sandbox_submit", "status"],
          supportedActions: ["demo_account_sync", "pricing", "order_preview", "sandbox_submit", "status"],
          disabledActions: ["live_order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Sandbox/demonstration only", "Disabled by default"],
          costLevel: "low",
          authMethod: "api_key",
          environment: this.env.GENERIC_REST_BROKER_BASE_URL?.trim() ? "bridge" : "disabled",
          health: this.env.GENERIC_REST_BROKER_BASE_URL?.trim() ? "healthy" : "disabled",
          limitations: [
            "Disabled by default.",
            "Only demo/sandbox workflows are supported.",
          ],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: Boolean(this.env.GENERIC_REST_BROKER_BASE_URL?.trim()),
          requiredEnvVars: ["GENERIC_REST_BROKER_BASE_URL"],
          missingEnvVars: ["GENERIC_REST_BROKER_BASE_URL"].filter((key) => !this.env[key]?.trim()),
          lastCheckedAt,
          lastSyncAt: this.env.GENERIC_REST_BROKER_BASE_URL?.trim() ? lastCheckedAt : null,
        }),
        this.connector({
          id: "fred",
          name: "FRED Data Source",
          type: "data_provider",
          providerName: "FRED",
          connectorType: "data_provider",
          environmentLabel: "internal",
          supportedAssetClasses: ["macro"],
          supportedCapabilities: ["economic_series", "freshness_check"],
          supportedActions: ["economic_series", "freshness_check"],
          disabledActions: ["order_submission", "withdrawals", "transfers"],
          safetyConstraints: ["Read-only data source", "Demo/internal source until a live adapter is configured"],
          costLevel: "free",
          authMethod: "none",
          environment: "internal",
          health: "healthy",
          limitations: ["Demo/internal source until a live adapter is configured."],
          liveExecutionSupport: false,
          sandboxSupport: true,
          configured: true,
          requiredEnvVars: [],
          missingEnvVars: [],
          lastCheckedAt,
          lastSyncAt: lastCheckedAt,
        }),
      ],
    };
  }

  private connector(report: Omit<
    ToolConnectorReport,
    | "accountMode"
    | "demoVerificationStatus"
    | "demoVerificationSource"
    | "executionAllowed"
    | "executionBlockedReason"
    | "lastAccountModeVerificationAt"
    | "liveCapabilityDisabledReason"
    | "enabled"
  > & { enabled?: boolean }): ToolConnectorReport {
    const accountMode = accountModeForConnector(report.id, report.environment);
    const demoVerificationSource = verificationSourceForConnector(report.id, report.environment);
    const policy = demoOnlyPolicyService.check({
      provider: report.id,
      accountMode,
      verificationSource: demoVerificationSource,
      attemptedAction: "connector.matrix",
      actor: "system",
      source: "tool-connector-registry",
      now: new Date(report.lastCheckedAt),
    });
    const canExecute = report.type === "broker" || report.id === "metatrader_demo";
    const executionAllowed = canExecute && report.configured && report.health !== "disabled" && policy.allowed;
    return {
      ...report,
      accountMode,
      demoVerificationStatus: policy.allowed ? "verified" : demoVerificationSource === "unverified" ? "unverified" : "blocked",
      demoVerificationSource,
      executionAllowed,
      executionBlockedReason: executionAllowed
        ? null
        : canExecute
          ? policy.reason
          : "Provider is read-only, advisory, or notification-only.",
      liveCapabilityDisabledReason: "Live capability disabled by MarketPilot demo-only policy.",
      lastAccountModeVerificationAt: policy.timestamp,
      enabled: report.enabled ?? report.configured,
    };
  }

  private envConfigured(keys: string[], fallback: ConnectorHealth = "disabled"): ConnectorHealth {
    return keys.every((key) => Boolean(this.env[key]?.trim())) ? "healthy" : fallback;
  }

  private telegramAllowedUserId() {
    return this.env.TELEGRAM_ALLOWED_USER_ID?.trim() || this.env.TELEGRAM_CHAT_ID?.trim() || "";
  }

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
}

export const toolConnectorRegistryService = new ToolConnectorRegistryService();

function accountModeForConnector(id: string, environment: ToolConnectorReport["environment"]): AccountMode {
  switch (id) {
    case "oanda_practice":
      return "practice";
    case "metatrader_demo":
      return "demo";
    case "tradingview_webhook":
      return "simulated";
    case "analysis_tools":
    case "fred":
      return "simulated";
    case "telegram_notifications":
      return "simulated";
    case "generic_rest_broker":
      return "unverified";
    default:
      return environment === "paper" || environment === "practice" || environment === "demo" ? environment : "unverified";
  }
}

function verificationSourceForConnector(id: string, environment: ToolConnectorReport["environment"]) {
  switch (id) {
    case "oanda_practice":
      return "OANDA_ENV=practice";
    case "metatrader_demo":
      return "METATRADER_DEMO_BRIDGE_URL";
    case "tradingview_webhook":
      return "webhook.signal_ingestion_advisory_only";
    case "analysis_tools":
    case "fred":
      return "internal.read_only";
    case "telegram_notifications":
      return "telegram.control_channel_no_execution";
    default:
      return environment === "disabled" ? "unverified" : "connector.metadata";
  }
}
