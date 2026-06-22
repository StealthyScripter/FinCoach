import type { MarketPilotOverview, MetricsSnapshot, VerificationQualityReport } from "@shared/schema";
import { eventLogService } from "./eventLogService";
import { getStorageMode } from "./storageMode";

const startedAt = Date.now();

export class MetricsService {
  private requestCount = 0;
  private rateLimitCount = 0;

  recordRequest() {
    this.requestCount += 1;
  }

  recordRateLimit() {
    this.rateLimitCount += 1;
    eventLogService.append({
      type: "rate_limit.triggered",
      userId: "anonymous",
      sourceService: "gateway-service",
      payload: { requestCount: this.requestCount },
    });
  }

  snapshot({
    overview,
    verificationQuality,
    now = new Date(),
  }: {
    overview: MarketPilotOverview;
    verificationQuality: VerificationQualityReport;
    now?: Date;
  }): MetricsSnapshot {
    const verificationChecks = [
      ...overview.researchReports.map((report) => report.verification),
      ...overview.tradeTickets.map((ticket) => ticket.verification),
    ];
    const riskChecks = overview.tradeTickets.map((ticket) => ticket.riskCheck);

    return {
      generatedAt: now.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      storageMode: getStorageMode(),
      requestCount: this.requestCount,
      rateLimitCount: this.rateLimitCount,
      supervisorWorkflowCount: eventLogService.countByType("supervisor.workflow_completed"),
      verificationPassCount: verificationChecks.filter((check) => ["verified", "partially_verified"].includes(check.status)).length,
      verificationFailCount: verificationChecks.filter((check) => ["not_verified", "conflicting_evidence", "requires_human_review"].includes(check.status)).length,
      riskApprovalCount: riskChecks.filter((check) => check.decision === "approve").length,
      riskRejectionCount: riskChecks.filter((check) => check.decision !== "approve").length,
      paperTradeCount: overview.tradeTickets.filter((ticket) => ["paper_filled", "closed"].includes(ticket.status)).length,
      evaluationBenchmarkCount: eventLogService.countByType("evaluation.completed"),
      averageVerificationScore: average(verificationChecks.map((check) => check.confidence)),
      averageHallucinationRiskScore: verificationQuality.hallucinationRiskScore,
      eventLogCount: eventLogService.snapshot(now).eventCount,
    };
  }
}

export const metricsService = new MetricsService();

export function renderPrometheusMetrics(snapshot: MetricsSnapshot): string {
  const lines = [
    "# HELP marketpilot_uptime_seconds Time since the process started.",
    "# TYPE marketpilot_uptime_seconds gauge",
    `marketpilot_uptime_seconds ${snapshot.uptimeSeconds}`,
    "# HELP marketpilot_storage_mode_info Current storage backend, exposed as an info metric.",
    "# TYPE marketpilot_storage_mode_info gauge",
    `marketpilot_storage_mode_info{mode="${escapeLabelValue(snapshot.storageMode)}"} 1`,
    "# HELP marketpilot_request_count_total Total API requests observed by the gateway.",
    "# TYPE marketpilot_request_count_total counter",
    `marketpilot_request_count_total ${snapshot.requestCount}`,
    "# HELP marketpilot_rate_limit_count_total Total rate limit rejections observed by the gateway.",
    "# TYPE marketpilot_rate_limit_count_total counter",
    `marketpilot_rate_limit_count_total ${snapshot.rateLimitCount}`,
    "# HELP marketpilot_supervisor_workflows_total Supervisor workflows completed.",
    "# TYPE marketpilot_supervisor_workflows_total counter",
    `marketpilot_supervisor_workflows_total ${snapshot.supervisorWorkflowCount}`,
    "# HELP marketpilot_verification_pass_total Verification checks that passed or partially passed.",
    "# TYPE marketpilot_verification_pass_total counter",
    `marketpilot_verification_pass_total ${snapshot.verificationPassCount}`,
    "# HELP marketpilot_verification_fail_total Verification checks that failed or require human review.",
    "# TYPE marketpilot_verification_fail_total counter",
    `marketpilot_verification_fail_total ${snapshot.verificationFailCount}`,
    "# HELP marketpilot_risk_approval_total Risk checks that approved a trade.",
    "# TYPE marketpilot_risk_approval_total counter",
    `marketpilot_risk_approval_total ${snapshot.riskApprovalCount}`,
    "# HELP marketpilot_risk_rejection_total Risk checks that rejected a trade.",
    "# TYPE marketpilot_risk_rejection_total counter",
    `marketpilot_risk_rejection_total ${snapshot.riskRejectionCount}`,
    "# HELP marketpilot_paper_trade_total Paper trades that filled or closed.",
    "# TYPE marketpilot_paper_trade_total counter",
    `marketpilot_paper_trade_total ${snapshot.paperTradeCount}`,
    "# HELP marketpilot_evaluation_benchmark_total Evaluation runs completed.",
    "# TYPE marketpilot_evaluation_benchmark_total counter",
    `marketpilot_evaluation_benchmark_total ${snapshot.evaluationBenchmarkCount}`,
    "# HELP marketpilot_average_verification_score Average verification confidence across tracked items.",
    "# TYPE marketpilot_average_verification_score gauge",
    `marketpilot_average_verification_score ${snapshot.averageVerificationScore}`,
    "# HELP marketpilot_average_hallucination_risk_score Average hallucination risk score from verification quality.",
    "# TYPE marketpilot_average_hallucination_risk_score gauge",
    `marketpilot_average_hallucination_risk_score ${snapshot.averageHallucinationRiskScore}`,
    "# HELP marketpilot_event_log_count_total Total events currently retained in the event log.",
    "# TYPE marketpilot_event_log_count_total counter",
    `marketpilot_event_log_count_total ${snapshot.eventLogCount}`,
  ];

  return `${lines.join("\n")}\n`;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
