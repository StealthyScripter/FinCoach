import type { Alert, MarketPilotOverview } from "@shared/schema";
import type { MarketEvent } from "./eventCalendarService";

export class AlertService {
  evaluateAlerts({
    overview,
    events,
    now = new Date(),
  }: {
    overview: MarketPilotOverview;
    events: MarketEvent[];
    now?: Date;
  }): Alert[] {
    const createdAt = now.toISOString();
    const alerts: Alert[] = [];
    const highImpactEvents = events.filter((event) => event.impact === "high");
    const blockedTickets = overview.tradeTickets.filter((ticket) => ticket.status === "risk_rejected");
    const optionsScore = overview.proficiencyScores.find((score) => score.category === "options")?.score ?? 0;
    const concentration = overview.portfolio.holdings.find((holding) => holding.allocation >= 40);
    const reviewReports = overview.researchReports.filter((report) => report.verification.status === "requires_human_review");

    for (const event of highImpactEvents) {
      alerts.push(buildAlert({
        id: `alert-event-${event.id}`,
        severity: "critical",
        category: "event_risk",
        title: event.title,
        message: event.riskNote,
        trigger: `High-impact event within event calendar: ${event.startsAt}`,
        relatedAssets: event.relatedAssets,
        requiredActions: [
          "Review event risk before submitting affected trade tickets",
          "Wait for the event to pass unless explicitly documenting event-risk approval",
        ],
        createdAt,
      }));
    }

    if (blockedTickets.length > 0) {
      alerts.push(buildAlert({
        id: "alert-risk-blocked-tickets",
        severity: "critical",
        category: "risk_rule",
        title: "Risk Officer blocked paper ticket",
        message: `${blockedTickets.length} ticket(s) are currently risk-rejected and cannot be paper filled.`,
        trigger: blockedTickets.map((ticket) => `${ticket.asset}: ${ticket.riskCheck.decision}`).join("; "),
        relatedAssets: blockedTickets.map((ticket) => ticket.asset),
        requiredActions: ["Complete required risk actions", "Do not resubmit the same idea without a revised rationale"],
        createdAt,
      }));
    }

    if (optionsScore < 70) {
      alerts.push(buildAlert({
        id: "alert-options-gate",
        severity: "warning",
        category: "proficiency_gate",
        title: "Options simulation gate locked",
        message: `Options proficiency is ${optionsScore}/100; paper options tickets remain blocked.`,
        trigger: "Options proficiency below 70 unlock threshold",
        relatedAssets: ["SPY", "QQQ"],
        requiredActions: ["Complete options max-loss module", "Pass assignment-risk assessment", "Use the payoff simulator only"],
        createdAt,
      }));
    }

    if (concentration) {
      alerts.push(buildAlert({
        id: `alert-concentration-${concentration.symbol.toLowerCase()}`,
        severity: "warning",
        category: "portfolio_drift",
        title: `${concentration.symbol} concentration watch`,
        message: `${concentration.symbol} is ${concentration.allocation.toFixed(1)}% of the paper portfolio.`,
        trigger: "Single ETF allocation at or above 40%",
        relatedAssets: [concentration.symbol],
        requiredActions: ["Compare against model portfolios", "Check concentration before creating a rebalance ticket"],
        createdAt,
      }));
    }

    if (reviewReports.length > 0) {
      alerts.push(buildAlert({
        id: "alert-verification-review",
        severity: "warning",
        category: "verification",
        title: "Human verification required",
        message: `${reviewReports.length} research or ticket verification item(s) require human review.`,
        trigger: "Verification status requires_human_review",
        relatedAssets: reviewReports.map((report) => report.asset ?? report.agent.toUpperCase()),
        requiredActions: ["Review contradictory evidence", "Confirm source freshness before using the claim"],
        createdAt,
      }));
    }

    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }
}

export const alertService = new AlertService();

function buildAlert(alert: Omit<Alert, "status">): Alert {
  return {
    ...alert,
    status: "active",
  };
}

function severityRank(severity: Alert["severity"]) {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}
