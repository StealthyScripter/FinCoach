import type { Position } from "./domain";
import type { StrategyValidationScorecard } from "./strategyValidation";
import type { RiskPrecheckDecision } from "./riskPrecheck";
import type { AutomationLevelService } from "./automationLevels";
import type { ExecutionAuditEntry } from "./riskControls";
import type { LiveReadinessReportService } from "./liveReadinessReport";

type LiveReadinessReport = ReturnType<LiveReadinessReportService["generate"]>;

export type ExecutionCenterProjectionInput = {
  automation: ReturnType<AutomationLevelService["snapshot"]>;
  killSwitchActive: boolean;
  latestSignals: Array<Record<string, unknown>>;
  positions: Position[];
  strategyValidations: StrategyValidationScorecard[];
  riskPrecheck: RiskPrecheckDecision;
  auditLog: ExecutionAuditEntry[];
  brokerReadiness: unknown;
  liveReadinessReport?: LiveReadinessReport;
  activeRiskLimits?: { maxDailyLoss: number; maxRiskPerTradePct: number };
};

export function selectExecutionCenterData(input: ExecutionCenterProjectionInput) {
  return {
    primary: {
      automationLevel: input.automation,
      killSwitchStatus: input.killSwitchActive ? "triggered" as const : "armed" as const,
      latestSignals: input.latestSignals.slice(0, 5),
      openPaperPositions: input.positions.slice(0, 5),
      strategyValidationVerdicts: input.strategyValidations.slice(0, 5).map((scorecard) => ({
        strategyId: scorecard.strategyId,
        instrument: scorecard.instrument,
        score: scorecard.overallScore,
        verdict: scorecard.verdict,
      })),
      riskPrecheckStatus: {
        action: input.riskPrecheck.action,
        reasons: input.riskPrecheck.reasons,
        checkedAt: input.riskPrecheck.checkedAt,
      },
      liveReadiness: input.liveReadinessReport
        ? selectLiveReadinessPanel(
            input.liveReadinessReport,
            input.activeRiskLimits ?? { maxDailyLoss: 0, maxRiskPerTradePct: 0 },
            input.killSwitchActive,
          )
        : null,
    },
    advanced: {
      backtests: { available: true },
      strategyValidation: input.strategyValidations,
      brokerReadiness: input.brokerReadiness,
      auditLog: input.auditLog,
      circuitBreakers: { killSwitchActive: input.killSwitchActive },
      liveReadinessDetails: input.liveReadinessReport?.sections ?? null,
    },
    safety: {
      unrestrictedAutonomousLiveTrading: false as const,
      liveOrderPlacementEnabled: false as const,
      explicitUserConfirmationRequired: true as const,
    },
  };
}

export function selectLiveReadinessPanel(
  report: LiveReadinessReport,
  activeRiskLimits: { maxDailyLoss: number; maxRiskPerTradePct: number },
  killSwitchTriggered: boolean,
) {
  return {
    readinessVerdict: report.verdict,
    missingRequirements: report.missingRequirements.slice(0, 5),
    activeRiskLimits,
    killSwitchState: killSwitchTriggered ? "triggered" as const : "armed" as const,
    nextRequiredAction: report.nextRequiredAction,
  };
}
