import type { OrderRequest } from "./domain";

export type RiskPrecheckAction = "approve" | "reject" | "reduce_size" | "wait" | "manual_review";

export type RiskPrecheckContext = {
  dataAgeSeconds: number;
  maxDataAgeSeconds: number;
  spread: number;
  maxSpread: number;
  volatilityPct: number;
  maxVolatilityPct: number;
  dailyLoss: number;
  maxDailyLoss: number;
  openPositions: number;
  maxOpenPositions: number;
  symbolExposure: number;
  requestedExposure: number;
  maxSymbolExposure: number;
  correlatedExposure: number;
  maxCorrelatedExposure: number;
  newsBlackoutActive: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  strategyEnabled: boolean;
  killSwitchActive: boolean;
  accountConnected: boolean;
  accountLastSyncAgeSeconds: number;
  maxAccountSyncAgeSeconds: number;
};

export type RiskPrecheckDecision = {
  action: RiskPrecheckAction;
  approved: boolean;
  sizeMultiplier: number;
  reasons: string[];
  checks: Array<{ id: string; passed: boolean; severity: "block" | "wait" | "reduce" | "review"; detail: string }>;
  checkedAt: string;
  liveUserConfirmationRequired: boolean;
};

export class ExecutionRiskPrecheckService {
  evaluate(request: OrderRequest, context: RiskPrecheckContext): RiskPrecheckDecision {
    const checks = [
      check("stale_data", context.dataAgeSeconds <= context.maxDataAgeSeconds, "wait", "Market data is stale"),
      check("spread", context.spread <= context.maxSpread, "wait", "Spread exceeds the configured limit"),
      check("volatility", context.volatilityPct <= context.maxVolatilityPct, "reduce", "Volatility exceeds the configured limit"),
      check("daily_loss", context.dailyLoss < context.maxDailyLoss, "block", "Daily loss limit reached"),
      check("open_positions", context.openPositions < context.maxOpenPositions, "block", "Maximum open positions reached"),
      check("symbol_exposure", context.symbolExposure + context.requestedExposure <= context.maxSymbolExposure, "reduce", "Maximum symbol exposure would be exceeded"),
      check("correlated_exposure", context.correlatedExposure + context.requestedExposure <= context.maxCorrelatedExposure, "review", "Maximum correlated exposure would be exceeded"),
      check("news_blackout", !context.newsBlackoutActive, "wait", "News blackout window is active"),
      check("repeated_losses", context.consecutiveLosses < context.maxConsecutiveLosses, "review", "Repeated loss threshold reached"),
      check("strategy_enabled", context.strategyEnabled, "block", "Strategy is disabled"),
      check("kill_switch", !context.killSwitchActive, "block", "Kill switch is active"),
      check("account_connection", context.accountConnected, "block", "Account connection is unhealthy"),
      check("account_sync", context.accountLastSyncAgeSeconds <= context.maxAccountSyncAgeSeconds, "wait", "Account synchronization is stale"),
      check("live_confirmation", request.mode !== "supervised_live" || request.explicitUserConfirmation, "block", "Explicit user confirmation is required for supervised live execution"),
    ];
    const failures = checks.filter((item) => !item.passed);
    const priorities: RiskPrecheckAction[] = ["reject", "wait", "manual_review", "reduce_size", "approve"];
    const candidateActions: RiskPrecheckAction[] = failures.map((item) => ({
      block: "reject" as const,
      wait: "wait" as const,
      review: "manual_review" as const,
      reduce: "reduce_size" as const,
    })[item.severity]);
    const action = priorities.find((item) => candidateActions.includes(item)) ?? "approve";
    return {
      action,
      approved: action === "approve" || action === "reduce_size",
      sizeMultiplier: action === "reduce_size" ? 0.5 : action === "approve" ? 1 : 0,
      reasons: failures.map((item) => item.detail),
      checks,
      checkedAt: new Date().toISOString(),
      liveUserConfirmationRequired: request.mode === "supervised_live",
    };
  }
}

function check(id: string, passed: boolean, severity: "block" | "wait" | "reduce" | "review", detail: string) {
  return { id, passed, severity, detail };
}

export const executionRiskPrecheckService = new ExecutionRiskPrecheckService();
