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

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
