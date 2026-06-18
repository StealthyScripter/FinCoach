import type {
  AgentOutput,
  EvaluationMetric,
  EvaluationReport,
  EvaluationSuite,
  MarketPilotOverview,
  PortfolioRiskAnalytics,
  ResearchReport,
  TradeTicket,
} from "@shared/schema";

const BENCHMARK_VERSION = "marketpilot-eval-v1";

export class EvaluationService {
  evaluate({
    overview,
    agents,
    portfolioRisk,
    now = new Date(),
  }: {
    overview: MarketPilotOverview;
    agents: AgentOutput[];
    portfolioRisk: PortfolioRiskAnalytics;
    now?: Date;
  }): EvaluationReport {
    const suites = [
      researchVerificationSuite(overview.researchReports, overview.tradeTickets),
      riskPerformanceSuite(overview, portfolioRisk),
      behavioralLearningSuite(overview),
      agentReliabilitySuite(agents),
    ];
    const overallScore = roundedAverage(suites.map((suite) => suite.score));
    const requiredActions = suites.flatMap((suite) =>
      suite.metrics.flatMap((metric) => metric.requiredActions),
    );

    return {
      id: `evaluation-${BENCHMARK_VERSION}`,
      generatedAt: now.toISOString(),
      overallScore,
      status: statusFromScore(overallScore),
      benchmarkVersion: BENCHMARK_VERSION,
      suites,
      requiredActions: unique(requiredActions),
      monitoring: {
        recommendedMetrics: [
          "evaluation_overall_score",
          "evaluation_research_quality_score",
          "evaluation_hallucination_risk_score",
          "evaluation_risk_discipline_score",
          "evaluation_agent_agreement_score",
        ],
        alertThresholds: [
          "Page risk/compliance owner when overall score drops below 70.",
          "Block paper fills when hallucination-risk score drops below 65.",
          "Require human review when citation accuracy drops below 75.",
        ],
      },
      security: {
        piiIncluded: false,
        executionBlocked: true,
        notes: [
          "Evaluation reads existing MarketPilot records and does not call external tools.",
          "No broker credentials, account numbers, or personally identifying fields are included.",
          "Evaluation output cannot approve or place trades.",
        ],
      },
    };
  }
}

export const evaluationService = new EvaluationService();

function researchVerificationSuite(reports: ResearchReport[], tickets: TradeTicket[]): EvaluationSuite {
  const reportConfidence = reports.map((report) => report.confidence);
  const verifiedReports = reports.filter((report) => report.verification.status === "verified").length;
  const partlyVerifiedReports = reports.filter((report) => report.verification.status === "partially_verified").length;
  const reportsWithSources = reports.filter((report) => report.verification.sources.length > 0).length;
  const reportsWithContradictions = reports.filter((report) => report.verification.contradictoryEvidence.length > 0).length;
  const reportsWithDisproof = reports.filter((report) => report.verification.whatWouldDisprove.length > 8).length;
  const ticketVerificationScores = tickets.map((ticket) => ticket.verification.confidence);

  const metrics: EvaluationMetric[] = [
    metric({
      id: "research_quality",
      label: "Research quality",
      score: weightedAverage([
        ratio(reportsWithSources, reports.length) * 30,
        ratio(reportsWithContradictions, reports.length) * 20,
        ratio(reportsWithDisproof, reports.length) * 20,
        average(reportConfidence) * 0.3,
      ]),
      target: 80,
      evidence: [
        `${reports.length} research report(s) evaluated.`,
        `${reportsWithSources} report(s) include source records.`,
        `${reportsWithContradictions} report(s) include contradictory evidence.`,
        `${reportsWithDisproof} report(s) include an invalidation condition.`,
      ],
      requiredActions: reports.length === 0
        ? ["Generate at least one verified market briefing before agent evaluation."]
        : [],
    }),
    metric({
      id: "citation_accuracy",
      label: "Citation accuracy",
      score: Math.min(100, ratio(reportsWithSources, reports.length) * 70 + ratio(verifiedReports + partlyVerifiedReports, reports.length) * 30),
      target: 85,
      evidence: [
        `${verifiedReports} report(s) verified and ${partlyVerifiedReports} partially verified.`,
        `${reportsWithSources} report(s) have timestamped citations.`,
      ],
      requiredActions: reportsWithSources < reports.length
        ? ["Require timestamped sources for every research report before ticket creation."]
        : [],
    }),
    metric({
      id: "hallucination_risk",
      label: "Hallucination risk control",
      score: Math.min(100, average([...reports.map((report) => report.verification.confidence), ...ticketVerificationScores])),
      target: 75,
      evidence: [
        `${reports.length} report verification score(s) and ${tickets.length} ticket verification score(s) sampled.`,
        "Scores are conservative until real provider-backed verification is connected.",
      ],
      requiredActions: reports.some((report) => report.verification.status === "requires_human_review")
        ? ["Route requires-review reports to a human before use in trade tickets."]
        : [],
    }),
    metric({
      id: "confidence_calibration",
      label: "Confidence calibration",
      score: confidenceCalibrationScore(reports),
      target: 75,
      evidence: [
        "Compares report confidence against verification confidence.",
        "Large gaps imply overconfident or under-supported explanations.",
      ],
      requiredActions: reports.some((report) => Math.abs(report.confidence - report.verification.confidence) > 20)
        ? ["Calibrate report confidence against verification confidence before surfacing as recommendation support."]
        : [],
    }),
  ];

  return suite({
    id: "research_verification",
    label: "Research and verification",
    objective: "Validate citations, source freshness, contradiction handling, hallucination control, and confidence calibration.",
    metrics,
  });
}

function riskPerformanceSuite(overview: MarketPilotOverview, portfolioRisk: PortfolioRiskAnalytics): EvaluationSuite {
  const approvedTickets = overview.tradeTickets.filter((ticket) => ticket.riskCheck.decision === "approve").length;
  const unsafeTickets = overview.tradeTickets.filter((ticket) =>
    ticket.riskCheck.decision === "approve" && ticket.verification.status === "not_verified",
  ).length;
  const rejectedOrReduced = overview.tradeTickets.filter((ticket) =>
    ["reject", "reduce_size", "cooling_off", "require_more_research"].includes(ticket.riskCheck.decision),
  ).length;

  const metrics: EvaluationMetric[] = [
    metric({
      id: "risk_discipline",
      label: "Risk discipline",
      score: Math.max(0, 100 - unsafeTickets * 25 - portfolioRisk.riskBreaches.length * 8),
      target: 85,
      evidence: [
        `${approvedTickets} approved ticket(s), ${rejectedOrReduced} reduced/rejected/cooling-off ticket(s).`,
        `${portfolioRisk.riskBreaches.length} portfolio risk breach(es) detected.`,
        `Risk Officer veto is ${overview.user.liveTradingEnabled ? "feature-gated" : "active with live trading disabled"}.`,
      ],
      requiredActions: unsafeTickets > 0
        ? ["Block any approved ticket with not-verified evidence."]
        : portfolioRisk.riskBreaches,
    }),
    metric({
      id: "drawdown_control",
      label: "Drawdown control",
      score: clamp(100 - overview.portfolio.maxDrawdownPct * 4),
      target: 75,
      evidence: [
        `Current paper max drawdown is ${overview.portfolio.maxDrawdownPct.toFixed(1)}%.`,
        `Portfolio VaR95 estimate is $${portfolioRisk.valueAtRisk95.toLocaleString()}.`,
      ],
      requiredActions: overview.portfolio.maxDrawdownPct > 10
        ? ["Require scenario simulation and journal review before increasing risk."]
        : [],
    }),
    metric({
      id: "sharpe_quality",
      label: "Sharpe quality",
      score: ratioScore(portfolioRisk.sharpeRatio, 1.2),
      target: 70,
      evidence: [`Estimated paper portfolio Sharpe ratio is ${portfolioRisk.sharpeRatio}.`],
      requiredActions: portfolioRisk.sharpeRatio < 0.8
        ? ["Review allocation efficiency before new rebalance tickets."]
        : [],
    }),
    metric({
      id: "sortino_quality",
      label: "Sortino quality",
      score: ratioScore(portfolioRisk.sortinoRatio, 1.6),
      target: 70,
      evidence: [`Estimated paper portfolio Sortino ratio is ${portfolioRisk.sortinoRatio}.`],
      requiredActions: portfolioRisk.sortinoRatio < 1
        ? ["Investigate downside-volatility contributors in Simulation Lab."]
        : [],
    }),
  ];

  return suite({
    id: "risk_performance",
    label: "Risk and performance",
    objective: "Measure risk controls, drawdown management, and paper portfolio risk-adjusted quality.",
    metrics,
  });
}

function behavioralLearningSuite(overview: MarketPilotOverview): EvaluationSuite {
  const tradingPsychology = overview.proficiencyScores.find((score) => score.category === "trading_psychology");
  const riskManagement = overview.proficiencyScores.find((score) => score.category === "risk_management");
  const journalAverage = average(overview.journalEntries.map((entry) => entry.qualityScore));
  const coolingOffTickets = overview.tradeTickets.filter((ticket) => ticket.riskCheck.decision === "cooling_off").length;

  const metrics: EvaluationMetric[] = [
    metric({
      id: "behavioral_discipline",
      label: "Behavioral discipline",
      score: clamp(weightedAverage([
        (tradingPsychology?.score ?? 0) * 0.35,
        (riskManagement?.score ?? 0) * 0.35,
        journalAverage * 0.3,
      ]) - coolingOffTickets * 8),
      target: 75,
      evidence: [
        `Trading psychology score is ${tradingPsychology?.score ?? 0}/100.`,
        `Risk management score is ${riskManagement?.score ?? 0}/100.`,
        `Average journal quality is ${Math.round(journalAverage)}/100 across ${overview.journalEntries.length} entry/entries.`,
      ],
      requiredActions: journalAverage < 70
        ? ["Require higher-quality journal reviews before advancing live readiness."]
        : [],
    }),
  ];

  return suite({
    id: "behavioral_learning",
    label: "Behavioral learning",
    objective: "Evaluate discipline, journal quality, risk-management learning, and emotional-trading controls.",
    metrics,
  });
}

function agentReliabilitySuite(agents: AgentOutput[]): EvaluationSuite {
  const agentsWithCitations = agents.filter((agent) => agent.citations.length > 0).length;
  const riskAgent = agents.find((agent) => agent.agent === "risk");
  const verificationAgent = agents.find((agent) => agent.agent === "verification");
  const blockedWithoutRisk = agents.some((agent) => agent.status === "blocked") && riskAgent?.status === "clear";
  const confidenceSpread = agents.length > 0
    ? Math.max(...agents.map((agent) => agent.confidence)) - Math.min(...agents.map((agent) => agent.confidence))
    : 100;

  const metrics: EvaluationMetric[] = [
    metric({
      id: "agent_agreement",
      label: "Agent agreement",
      score: clamp(100 - confidenceSpread * 0.8 - (blockedWithoutRisk ? 25 : 0)),
      target: 75,
      evidence: [
        `${agents.length} structured agent output(s) evaluated.`,
        `Confidence spread is ${confidenceSpread} point(s).`,
        `Risk agent status is ${riskAgent?.status ?? "missing"}; verification agent status is ${verificationAgent?.status ?? "missing"}.`,
      ],
      requiredActions: blockedWithoutRisk
        ? ["Escalate inconsistency: another agent is blocked while Risk Officer is clear."]
        : agentsWithCitations < agents.length
          ? ["Require citations on every agent output."]
          : [],
    }),
  ];

  return suite({
    id: "agent_reliability",
    label: "Agent reliability",
    objective: "Check structured agent output coverage, citation discipline, and disagreement requiring supervisor review.",
    metrics,
  });
}

function metric(input: Omit<EvaluationMetric, "status">): EvaluationMetric {
  return {
    ...input,
    score: clamp(input.score),
    status: statusFromScore(input.score),
  };
}

function suite(input: Omit<EvaluationSuite, "score" | "status">): EvaluationSuite {
  const score = roundedAverage(input.metrics.map((item) => item.score));
  return {
    ...input,
    score,
    status: statusFromScore(score),
  };
}

function confidenceCalibrationScore(reports: ResearchReport[]) {
  if (reports.length === 0) return 0;
  const averageGap = average(reports.map((report) => Math.abs(report.confidence - report.verification.confidence)));
  return clamp(100 - averageGap * 2.5);
}

function statusFromScore(score: number): "pass" | "watch" | "fail" {
  if (score >= 80) return "pass";
  if (score >= 60) return "watch";
  return "fail";
}

function weightedAverage(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundedAverage(values: number[]) {
  return Math.round(average(values));
}

function ratio(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function ratioScore(value: number, target: number) {
  if (target === 0) return 0;
  return clamp((value / target) * 100);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
