import type { MarketPilotOverview, VerificationCheck, VerificationQualityReport } from "@shared/schema";

const STALE_SOURCE_MINUTES = 24 * 60;

export class VerificationQualityService {
  evaluate(overview: MarketPilotOverview, now = new Date()): VerificationQualityReport {
    const checks = [
      ...overview.researchReports.map((report) => report.verification),
      ...overview.tradeTickets.map((ticket) => ticket.verification),
    ];
    const sources = checks.flatMap((check) => check.sources);
    const staleSources = sources
      .filter((source) => minutesBetween(source.timestamp, now.toISOString()) > STALE_SOURCE_MINUTES)
      .map((source) => `${source.name} (${source.timestamp})`);
    const highReliability = sources.filter((source) => source.reliability === "high").length;
    const mediumReliability = sources.filter((source) => source.reliability === "medium").length;
    const lowReliability = sources.filter((source) => source.reliability === "low").length;
    const freshnessScore = sources.length === 0 ? 0 : clamp(100 - (staleSources.length / sources.length) * 70);
    const evidenceWeightScore = sources.length === 0
      ? 0
      : clamp(((highReliability * 1 + mediumReliability * 0.72 + lowReliability * 0.35) / sources.length) * 100);
    const contradictionScore = clamp(average(checks.map((check) =>
      check.contradictoryEvidence.length > 0 && check.whatWouldDisprove.length > 12 ? 100 : 45,
    )));
    const hallucinationRiskScore = clamp(average(checks.map((check) =>
      check.status === "verified"
        ? check.confidence
        : check.status === "partially_verified"
          ? check.confidence * 0.82
          : check.status === "conflicting_evidence"
            ? check.confidence * 0.45
            : check.confidence * 0.35,
    )));
    const score = clamp(average([
      freshnessScore,
      evidenceWeightScore,
      contradictionScore,
      hallucinationRiskScore,
    ]));
    const requiredActions = [
      sources.length === 0 ? "Attach timestamped sources before using any claim in a ticket." : null,
      staleSources.length > 0 ? "Refresh stale sources before treating explanations as current." : null,
      checks.some((check) => check.status === "requires_human_review") ? "Route requires-review checks to a human reviewer." : null,
      checks.some((check) => check.status === "conflicting_evidence") ? "Resolve conflicting evidence before trade-ticket approval." : null,
      evidenceWeightScore < 70 ? "Prefer high-reliability sources for claims used in recommendations." : null,
    ].filter((item): item is string => Boolean(item));

    return {
      id: "verification-quality-current",
      generatedAt: now.toISOString(),
      status: verificationStatus(score, requiredActions, checks),
      score,
      freshnessScore,
      evidenceWeightScore,
      contradictionScore,
      hallucinationRiskScore,
      sampledClaims: checks.length,
      sourceCoverage: {
        totalSources: sources.length,
        highReliability,
        mediumReliability,
        lowReliability,
        staleSources,
      },
      evidence: [
        `${checks.length} verification check(s) sampled from research reports and trade tickets.`,
        `${sources.length} source record(s) inspected for reliability and freshness.`,
        `${staleSources.length} stale source(s) found using a ${STALE_SOURCE_MINUTES}-minute threshold.`,
        `Average verification confidence is ${Math.round(average(checks.map((check) => check.confidence)))}/100.`,
      ],
      requiredActions,
    };
  }
}

export const verificationQualityService = new VerificationQualityService();

function verificationStatus(
  score: number,
  requiredActions: string[],
  checks: VerificationCheck[],
): VerificationQualityReport["status"] {
  if (checks.some((check) => check.status === "conflicting_evidence")) return "conflicting";
  if (requiredActions.length > 0 || score < 60) return "requires_review";
  if (score >= 82) return "verified";
  return "partially_verified";
}

function minutesBetween(leftIso: string, rightIso: string) {
  return Math.abs(new Date(rightIso).getTime() - new Date(leftIso).getTime()) / 60000;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
