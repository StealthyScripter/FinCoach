import type {
  MarketPilotOverview,
  SupervisorReport,
  SupervisorTicketReview,
  SupervisorWorkflowStep,
  TradeTicket,
} from "@shared/schema";

const WORKFLOW: SupervisorWorkflowStep["id"][] = [
  "idea",
  "verification",
  "risk",
  "portfolio_impact",
  "compliance",
  "human_approval",
  "execution",
];

export class AgentSupervisorService {
  review(overview: MarketPilotOverview, now = new Date()): SupervisorReport {
    const ticketReviews = overview.tradeTickets.map((ticket) => reviewTicket(ticket, overview));
    const requiredActions = unique(ticketReviews.flatMap((review) =>
      review.steps.flatMap((step) => step.requiredActions),
    ));
    const liveBlocked = !overview.user.liveTradingEnabled || overview.progression.liveTradingUnlock !== "unlocked";

    return {
      id: "agent-supervisor-current",
      generatedAt: now.toISOString(),
      mode: liveBlocked ? "live_blocked" : "paper_supervision",
      workflow: WORKFLOW,
      summary:
        "Supervisor enforces idea -> verification -> risk -> portfolio impact -> compliance -> human approval -> execution sequencing. AI agents cannot execute trades.",
      blockedCapabilities: [
        "Autonomous trade placement",
        "Live order placement by an AI agent",
        "Skipping Risk Officer veto",
        "Skipping Verification Agent review",
        "Skipping human approval",
      ],
      ticketReviews,
      requiredActions,
    };
  }
}

export const agentSupervisorService = new AgentSupervisorService();

function reviewTicket(ticket: TradeTicket, overview: MarketPilotOverview): SupervisorTicketReview {
  const steps: SupervisorWorkflowStep[] = [
    step({
      id: "idea",
      label: "Trade idea captured",
      gateOwner: "supervisor",
      status: ticket.rationale.length > 0 && ticket.supportingEvidence.length > 0 ? "complete" : "blocked",
      evidence: [
        `Rationale length: ${ticket.rationale.length} characters.`,
        `${ticket.supportingEvidence.length} supporting evidence item(s).`,
      ],
      requiredActions: ticket.supportingEvidence.length === 0
        ? ["Add supporting evidence before any downstream review."]
        : [],
    }),
    step({
      id: "verification",
      label: "Verification Agent review",
      gateOwner: "verification_agent",
      status: verificationPasses(ticket) ? "complete" : "blocked",
      evidence: [
        `Verification status: ${ticket.verification.status}.`,
        `Verification confidence: ${ticket.verification.confidence}/100.`,
        `${ticket.verification.sources.length} source(s) attached.`,
      ],
      requiredActions: verificationPasses(ticket)
        ? []
        : ["Resolve verification gaps before risk or execution review can proceed."],
    }),
    step({
      id: "risk",
      label: "Risk Officer review",
      gateOwner: "risk_officer",
      status: ticket.riskCheck.decision === "approve" ? "complete" : "blocked",
      evidence: [
        `Risk decision: ${ticket.riskCheck.decision}.`,
        `Risk score: ${ticket.riskCheck.score}/100.`,
        ...ticket.riskCheck.reasons,
      ],
      requiredActions: ticket.riskCheck.decision === "approve"
        ? []
        : ticket.riskCheck.requiredActions,
    }),
    step({
      id: "portfolio_impact",
      label: "Portfolio impact review",
      gateOwner: "portfolio_agent",
      status: ticket.portfolioImpact.length > 0 ? "complete" : "blocked",
      evidence: [ticket.portfolioImpact],
      requiredActions: ticket.portfolioImpact.length > 0
        ? []
        : ["Attach portfolio impact before preview generation."],
    }),
    step({
      id: "compliance",
      label: "Compliance Officer review",
      gateOwner: "compliance_officer",
      status: overview.complianceProfile.disclosuresAccepted ? "complete" : "pending",
      evidence: [
        `Disclosures accepted: ${overview.complianceProfile.disclosuresAccepted ? "yes" : "no"}.`,
        `Disclosure version: ${overview.complianceProfile.disclosureVersion}.`,
      ],
      requiredActions: overview.complianceProfile.disclosuresAccepted
        ? []
        : ["Acknowledge MarketPilot risk and responsibility disclosures."],
    }),
    step({
      id: "human_approval",
      label: "Human approval",
      gateOwner: "human",
      status: ticket.status === "paper_filled" || ticket.status === "closed" ? "complete" : "pending",
      evidence: [`Ticket status: ${ticket.status}. Human approval remains mandatory before fill.`],
      requiredActions: ticket.status === "paper_filled" || ticket.status === "closed"
        ? []
        : ["User must review explanation, risk, verification, and preview before any fill."],
    }),
    step({
      id: "execution",
      label: "Execution Officer boundary",
      gateOwner: "execution_officer",
      status: "blocked",
      evidence: [
        "Execution service boundary is isolated from AI agents.",
        `Live trading enabled: ${overview.user.liveTradingEnabled ? "yes" : "no"}.`,
      ],
      requiredActions: ["Execution remains blocked for AI agents; only paper workflow can proceed after human confirmation."],
    }),
  ];
  const canRequestPaperPreview = steps
    .filter((item) => ["idea", "verification", "risk", "portfolio_impact"].includes(item.id))
    .every((item) => item.status === "complete") && ticket.status === "proposed";

  return {
    ticketId: ticket.id,
    asset: ticket.asset,
    status: ticket.status,
    canRequestPaperPreview,
    canPlaceLiveOrder: false,
    riskOfficerVeto: true,
    humanApprovalRequired: true,
    steps,
  };
}

function verificationPasses(ticket: TradeTicket) {
  return ["verified", "partially_verified"].includes(ticket.verification.status)
    && ticket.verification.confidence >= 70
    && ticket.verification.sources.length > 0;
}

function step(step: SupervisorWorkflowStep): SupervisorWorkflowStep {
  return step;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
