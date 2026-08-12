import type { StructuredLogger } from "./structuredLogger";
import { structuredLogger } from "./structuredLogger";
import type { DeploymentMetadata } from "./deploymentMetadata";

export type ObserverLogger = Pick<StructuredLogger, "v2" | "telegram" | "audit">;

export type MarketDataCoverage = {
  symbol: string;
  timeframe: string;
  session: string;
  provider: string;
  requested: number;
  successful: number;
  latestTimestamp: string | null;
  freshnessSeconds: number | null;
  stale: boolean;
};

export type ResearchCycleSummaryInput = {
  cycleId: string;
  correlationId: string;
  runtimeInstanceId: string;
  durationMs?: number;
  result: "completed" | "completed_with_blockers" | "failed" | "blocked";
  observationsAttempted: number;
  observationsCreated: number;
  observationsDeduplicated: number;
  hypothesesEvaluated: number;
  hypothesesCreated: number;
  experimentsRun: number;
  backtestsCompleted: number;
  rankedCandidates: number;
  forwardTestsStarted: number;
  blockers: Array<Record<string, unknown>>;
  pipeline: Record<string, number>;
  marketDataCoverage: MarketDataCoverage[];
  deployedRevision: DeploymentMetadata;
};

export type SafetyStateSnapshotInput = {
  runtimeInstanceId: string;
  reason: string;
  executionMode: string;
  killSwitchState: string;
  dailyLossBreakerState: string;
  brokerEnvironment: string;
  riskGateStatus: string;
  liveExecutionBlocked: boolean;
  deployedRevision: DeploymentMetadata;
};

export type ReportDeliverySummaryInput = {
  correlationId: string;
  reportId: string;
  deliveryAttempt: number;
  destinationHash: string;
  sent: boolean;
  reason: string | null;
  deployedRevision: DeploymentMetadata;
};

export function emitResearchCycleObserverSummaries(input: ResearchCycleSummaryInput, logger: ObserverLogger = structuredLogger) {
  const blockersByReason = countByReason(input.blockers);
  logger.v2({
    level: input.result === "failed" ? "error" : input.blockers.length ? "warn" : "info",
    event: "research_cycle_summary",
    message: "V2 research cycle observer summary",
    cycleId: input.cycleId,
    correlationId: input.correlationId,
    runtimeInstanceId: input.runtimeInstanceId,
    outcome: input.result,
    observationsAttempted: input.observationsAttempted,
    observationsCreated: input.observationsCreated,
    hypothesesCreated: input.hypothesesCreated,
    experimentsRun: input.experimentsRun,
    backtestsCompleted: input.backtestsCompleted,
    rankedCandidates: input.rankedCandidates,
    forwardTestsStarted: input.forwardTestsStarted,
    blockersByReason,
    durationMs: input.durationMs,
    deployedRevision: input.deployedRevision,
  });
  logger.v2({
    level: input.result === "failed" ? "error" : "info",
    event: "pipeline_summary",
    message: "V2 pipeline observer summary",
    cycleId: input.cycleId,
    correlationId: input.correlationId,
    runtimeInstanceId: input.runtimeInstanceId,
    outcome: input.result,
    ...input.pipeline,
    deployedRevision: input.deployedRevision,
  });
  for (const coverage of input.marketDataCoverage) {
    logger.v2({
      level: coverage.stale || coverage.successful < coverage.requested ? "warn" : "info",
      event: "market_data_coverage_summary",
      message: "V2 market data coverage observer summary",
      cycleId: input.cycleId,
      correlationId: input.correlationId,
      runtimeInstanceId: input.runtimeInstanceId,
      symbol: coverage.symbol,
      timeframe: coverage.timeframe,
      session: coverage.session,
      source: coverage.provider,
      provider: coverage.provider,
      requested: coverage.requested,
      successful: coverage.successful,
      latestTimestamp: coverage.latestTimestamp,
      freshnessSeconds: coverage.freshnessSeconds,
      stale: coverage.stale,
      outcome: coverage.successful === coverage.requested ? "complete" : coverage.successful > 0 ? "partial" : "failed",
      deployedRevision: input.deployedRevision,
    });
  }
}

export function emitSafetyStateSnapshot(input: SafetyStateSnapshotInput, logger: ObserverLogger = structuredLogger) {
  logger.audit({
    level: input.liveExecutionBlocked ? "info" : "warn",
    event: "safety_state_snapshot",
    message: "Safe execution state snapshot",
    runtimeInstanceId: input.runtimeInstanceId,
    reason: input.reason,
    executionMode: input.executionMode,
    killSwitchState: input.killSwitchState,
    dailyLossBreakerState: input.dailyLossBreakerState,
    brokerEnvironment: input.brokerEnvironment,
    riskGateStatus: input.riskGateStatus,
    liveExecutionBlocked: input.liveExecutionBlocked,
    deployedRevision: input.deployedRevision,
  });
}

export function emitReportDeliverySummary(input: ReportDeliverySummaryInput, logger: ObserverLogger = structuredLogger) {
  logger.telegram({
    level: input.sent ? "info" : "warn",
    event: "report_delivery_summary",
    message: "V2 report delivery observer summary",
    correlationId: input.correlationId,
    reportId: input.reportId,
    reportDeliveryStatus: input.sent ? "delivered" : "failed",
    deliveryAttempt: input.deliveryAttempt,
    destinationHash: input.destinationHash,
    outcome: input.sent ? "success" : "failure",
    reason: input.reason,
    deployedRevision: input.deployedRevision,
  });
}

export function countByReason(blockers: Array<Record<string, unknown>>) {
  return blockers.reduce<Record<string, number>>((acc, blocker) => {
    const reason = String(blocker.code ?? blocker.reason ?? "unknown");
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
}
