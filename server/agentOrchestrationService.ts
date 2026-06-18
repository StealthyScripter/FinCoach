import type { AgentName, AgentOutput, MarketPilotOverview, PaperPortfolio, ProficiencyScore, ResearchReport, RiskRule, TradeTicket } from "@shared/schema";

const AGENT_ORDER: AgentName[] = [
  "macro",
  "equity",
  "etf",
  "options",
  "forex",
  "commodities",
  "bonds",
  "portfolio",
  "risk",
  "verification",
];

export class AgentOrchestrationService {
  generateOutputs(overview: MarketPilotOverview, now = new Date()): AgentOutput[] {
    const generatedAt = now.toISOString();
    const context = {
      portfolio: overview.portfolio,
      riskRules: overview.riskRules,
      proficiencyScores: overview.proficiencyScores,
      tradeTickets: overview.tradeTickets,
      researchReports: overview.researchReports,
      generatedAt,
    };

    return AGENT_ORDER.map((agent) => buildAgentOutput(agent, context));
  }
}

export const agentOrchestrationService = new AgentOrchestrationService();

function buildAgentOutput(
  agent: AgentName,
  context: {
    portfolio: PaperPortfolio;
    riskRules: RiskRule[];
    proficiencyScores: ProficiencyScore[];
    tradeTickets: TradeTicket[];
    researchReports: ResearchReport[];
    generatedAt: string;
  },
): AgentOutput {
  const { portfolio, riskRules, proficiencyScores, tradeTickets, researchReports, generatedAt } = context;
  const blockedTickets = tradeTickets.filter((ticket) => ticket.status === "risk_rejected");
  const latestReport = researchReports[0];
  const citations = [
    {
      name: "MarketPilot paper portfolio",
      timestamp: generatedAt,
      reliability: "medium" as const,
    },
    {
      name: latestReport?.title ?? "MarketPilot research seed",
      timestamp: latestReport?.generatedAt ?? generatedAt,
      reliability: "medium" as const,
    },
  ];

  switch (agent) {
    case "macro":
      return output({
        agent,
        title: "Macro Regime Agent",
        assetFocus: "SPY / BND / DXY",
        status: "watch",
        summary: "Rates, inflation, and dollar pressure remain the dominant regime inputs for paper decisions.",
        observations: [
          "Front-end yield changes remain the first macro driver checked by the movement explainer.",
          "The event calendar can force cooling-off before major inflation releases.",
          "Cash and short bills still reduce stress-test drawdowns in the current portfolio.",
        ],
        recommendations: ["Keep macro-sensitive tickets in paper mode", "Review event risk before any equity or bond rebalance"],
        risks: ["Inflation surprises can pressure both equities and bonds", "Demo macro data is not a live feed"],
        confidence: 74,
        citations,
        generatedAt,
      });
    case "equity":
      return output({
        agent,
        title: "Equity Agent",
        assetFocus: "VTI / SPY / QQQ",
        status: blockedTickets.some((ticket) => ["VTI", "SPY", "QQQ"].includes(ticket.asset.toUpperCase())) ? "action_required" : "watch",
        summary: "Broad equity exposure is useful for learning but must remain sized by drawdown and event-risk controls.",
        observations: [
          `Current US equity allocation is ${allocationFor(portfolio, "VTI").toFixed(1)}%.`,
          "Equity tickets are blocked when high-impact macro events are inside the risk window.",
          "Rising concentration should route through portfolio and risk agents before paper fill.",
        ],
        recommendations: ["Prefer diversified ETFs while Foundation Mode remains active", "Require written invalidation conditions for equity tickets"],
        risks: ["Valuation compression", "Event-driven volatility", "Overconcentration in a single equity sleeve"],
        confidence: 70,
        citations,
        generatedAt,
      });
    case "etf":
      return output({
        agent,
        title: "ETF Agent",
        assetFocus: "VTI / VXUS / BND / SGOV",
        status: "clear",
        summary: "The paper portfolio is ETF-based, which fits the beginner and intermediate model-portfolio path.",
        observations: portfolio.holdings.map((holding) => `${holding.symbol}: ${holding.allocation.toFixed(1)}% allocation and ${holding.riskContribution.toFixed(1)}% risk contribution.`),
        recommendations: ["Compare rebalances against three-fund and 60/40 models", "Use ETF overlap review before adding similar funds"],
        risks: ["ETF overlap can hide concentration", "Bond ETF duration can still create drawdowns"],
        confidence: 78,
        citations,
        generatedAt,
      });
    case "options":
      return output({
        agent,
        title: "Options Agent",
        assetFocus: "SPY options simulation",
        status: optionsScore(proficiencyScores) >= 70 ? "watch" : "blocked",
        summary: "Options remain simulation-only until max-loss, assignment-risk, and proficiency gates improve.",
        observations: [
          `Current options proficiency is ${optionsScore(proficiencyScores)}/100.`,
          "The payoff simulator reports max loss, max profit, breakevens, assignment risk, and gate actions.",
          "Naked short calls are flagged as undefined loss risk and ineligible for paper-ticket approval.",
        ],
        recommendations: ["Complete options max-loss lessons", "Use defined-risk spreads only after the 85+ spread gate"],
        risks: ["Early assignment", "Premium decay", "Liquidity and bid/ask spread mismatch"],
        confidence: 82,
        citations,
        generatedAt,
      });
    case "forex":
      return output({
        agent,
        title: "Forex Agent",
        assetFocus: "EURUSD / DXY",
        status: "watch",
        summary: "Currency explanations should stay tied to rate differentials, dollar strength, and central-bank event risk.",
        observations: ["DXY is tracked as a related macro asset.", "EURUSD is event-linked to CPI in the demo risk calendar."],
        recommendations: ["Keep forex in explanation and paper-simulation mode", "Require macro source freshness before any FX thesis"],
        risks: ["Leverage", "Overnight gap risk", "Central-bank headline risk"],
        confidence: 66,
        citations,
        generatedAt,
      });
    case "commodities":
      return output({
        agent,
        title: "Commodities Agent",
        assetFocus: "Oil / inflation linkage",
        status: "watch",
        summary: "Commodity shocks are modeled through the oil-shock scenario and inflation linkage notes.",
        observations: ["Oil shock simulation is available in the Simulation Lab.", "Commodity moves can alter inflation expectations and sector leadership."],
        recommendations: ["Use scenario analysis before adding commodity exposure", "Tie commodity claims to supply, inventory, and inflation evidence"],
        risks: ["Geopolitical events", "Inventory surprises", "High roll-cost or fund-structure risk"],
        confidence: 64,
        citations,
        generatedAt,
      });
    case "bonds":
      return output({
        agent,
        title: "Bond Agent",
        assetFocus: "BND / SGOV",
        status: allocationFor(portfolio, "BND") > 25 ? "watch" : "clear",
        summary: "Bond exposure is split between core duration and short Treasury cash ballast.",
        observations: [
          `BND allocation is ${allocationFor(portfolio, "BND").toFixed(1)}%.`,
          `SGOV allocation is ${allocationFor(portfolio, "SGOV").toFixed(1)}%.`,
          "The 2022 rate-shock simulation explicitly tests stock/bond correlation stress.",
        ],
        recommendations: ["Review duration before increasing BND", "Use SGOV as the low-volatility learning sleeve"],
        risks: ["Duration risk", "Inflation surprises", "Credit-spread widening if bond scope expands"],
        confidence: 76,
        citations,
        generatedAt,
      });
    case "portfolio":
      return output({
        agent,
        title: "Portfolio Manager Agent",
        assetFocus: portfolio.name,
        status: portfolio.riskScore > 50 ? "action_required" : "watch",
        summary: `Portfolio risk score is ${portfolio.riskScore}/100 with $${portfolio.cash.toLocaleString()} paper cash.`,
        observations: [
          `Total paper value is $${portfolio.totalValue.toLocaleString()}.`,
          `Maximum drawdown recorded in the seed portfolio is ${portfolio.maxDrawdownPct.toFixed(1)}%.`,
          "Model portfolio comparisons are available before rebalance tickets.",
        ],
        recommendations: ["Check model drift before submitting rebalance tickets", "Keep position changes inside the written plan"],
        risks: ["Allocation drift", "Liquidity drag", "Misreading paper results as live readiness"],
        confidence: 80,
        citations,
        generatedAt,
      });
    case "risk":
      return output({
        agent,
        title: "Risk Officer Agent",
        assetFocus: "All tickets",
        status: blockedTickets.length > 0 ? "action_required" : "clear",
        summary: blockedTickets.length > 0
          ? `${blockedTickets.length} ticket(s) are blocked by risk controls. Risk Officer veto remains active.`
          : "No currently blocked ticket in the seeded overview, but all tickets still require risk approval.",
        observations: [
          `${riskRules.filter((rule) => rule.status === "active").length} active risk rules are configured.`,
          "Live trading remains disabled.",
          "Risk Officer output can override every other agent.",
        ],
        recommendations: ["Keep live execution locked", "Require event-risk and proficiency gates before approval"],
        risks: ["Oversizing", "Emotional trading after a rejected ticket", "Bypassing verification"],
        confidence: 88,
        citations,
        generatedAt,
      });
    case "verification":
      return output({
        agent,
        title: "Verification Agent",
        assetFocus: "Research and tickets",
        status: researchReports.some((report) => report.verification.status === "requires_human_review") ? "action_required" : "watch",
        summary: "Claims require source timestamps, contradiction checks, confidence scores, and disproof criteria.",
        observations: [
          `${researchReports.length} research report(s) are available for review.`,
          "Trade-ticket verification remains stricter than generated research because external market data is not connected.",
          "Movement explanations identify fact, interpretation, and prediction boundaries.",
        ],
        recommendations: ["Reject unsupported claims", "Prefer fresh source timestamps before ticket creation"],
        risks: ["Stale data", "Unsupported AI causality", "Conflicting evidence"],
        confidence: 84,
        citations,
        generatedAt,
      });
  }
}

function output(output: Omit<AgentOutput, "id">): AgentOutput {
  return {
    ...output,
    id: `agent-${output.agent}`,
  };
}

function allocationFor(portfolio: PaperPortfolio, symbol: string): number {
  return portfolio.holdings.find((holding) => holding.symbol.toUpperCase() === symbol.toUpperCase())?.allocation ?? 0;
}

function optionsScore(scores: ProficiencyScore[]): number {
  return scores.find((score) => score.category === "options")?.score ?? 0;
}
