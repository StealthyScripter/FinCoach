import type { LiveDataPaperOpsRuntime } from "./liveDataPaperOpsRuntime";
import type { ExecutionRiskService } from "./riskControls";

type OpsSnapshot = ReturnType<LiveDataPaperOpsRuntime["snapshot"]>;

export function selectStrategyPerformanceDashboard(snapshot: OpsSnapshot, risk: ReturnType<ExecutionRiskService["snapshot"]>) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    primary: {
      activePaperStrategies: snapshot.paperRuntime.filter((strategy) => strategy?.running).slice(0, 5),
      todaysSignals: snapshot.signals.filter((signal) => String(signal.createdAt).startsWith(today)).slice(-5).reverse(),
      openPositions: snapshot.openPositions.slice(0, 5).map((position) => ({
        id: position.id,
        strategyId: position.strategyId,
        symbol: position.symbol,
        side: position.side,
        unrealizedPnL: position.unrealizedPnL,
      })),
      pnlSummary: snapshot.pnl,
      riskStatus: {
        killSwitchActive: risk.globalKillSwitch,
        dailyLoss: risk.dailyLoss,
        maxDailyLoss: risk.maxDailyLoss,
        status: risk.globalKillSwitch || risk.dailyLoss >= risk.maxDailyLoss ? "blocked" as const : "operational" as const,
      },
    },
    advanced: {
      priceFeeds: snapshot.priceFeeds,
      strategyOps: snapshot.strategyOps,
      paperRuntime: snapshot.paperRuntime,
      postTradeReviews: snapshot.postTradeReviews,
      adaptationSuggestions: snapshot.adaptationSuggestions,
      strategyLifecycleReports: snapshot.strategyLifecycleReports,
      eventBlackouts: snapshot.eventBlackouts,
      metrics: snapshot.metrics,
    },
    safety: snapshot.safety,
  };
}
