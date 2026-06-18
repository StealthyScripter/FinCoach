import type {
  AgentConsensusReport,
  AgentOutput,
  BehavioralIntelligenceReport,
  CrossAssetRelationshipReport,
  FactorExposureReport,
  GreeksReport,
  InstitutionalAnalyticsSnapshot,
  MarketPilotOverview,
  MonteCarloSimulationReport,
  PaperPortfolio,
  ProficiencyGraphReport,
  RegimeReport,
  StressTestReport,
} from "@shared/schema";
import { agentOrchestrationService } from "./agentOrchestrationService";
import { verificationQualityService } from "./verificationQualityService";

type AssetClass = "stocks" | "etfs" | "forex" | "commodities" | "bonds" | "cash";

export class CorrelationEngine {
  analyze(portfolio: PaperPortfolio, now = new Date()): CrossAssetRelationshipReport {
    const symbols = [...portfolio.holdings.map((holding) => holding.symbol), "DXY", "US2Y", "OIL"];
    const relationships = pairs(symbols).map(([left, right]) => {
      const correlation = relationshipFor(left, right);
      return {
        left,
        right,
        relationship: correlation < -0.35 ? "inverse" as const : correlation > 0.55 ? "positive" as const : Math.abs(correlation) > 0.25 ? "regime_sensitive" as const : "weak" as const,
        rollingCorrelation: correlation,
        confidence: Math.round(62 + Math.abs(correlation) * 30),
        regimeSensitivity: regimeSensitivity(left, right),
        affectedAssets: [left, right],
      };
    });
    const concentrationWarnings = relationships
      .filter((item) => item.relationship === "positive" && item.rollingCorrelation > 0.7)
      .map((item) => `${item.left}/${item.right} may behave like one risk sleeve in stress.`);

    return {
      generatedAt: now.toISOString(),
      relationships,
      concentrationWarnings,
      affectedAssets: Array.from(new Set(relationships.flatMap((item) => item.affectedAssets))),
    };
  }
}

export class FactorExposureService {
  analyze(portfolio: PaperPortfolio, now = new Date()): FactorExposureReport {
    const equity = allocation(portfolio, ["VTI", "SPY", "QQQ"]);
    const international = allocation(portfolio, ["VXUS", "VEA", "VWO"]);
    const bonds = allocation(portfolio, ["BND", "AGG", "TLT", "IEF"]);
    const cash = portfolio.cash / portfolio.totalValue * 100 + allocation(portfolio, ["SGOV", "BIL", "SHV"]);
    const sector = {
      technology: round(equity * 0.28),
      financials: round(equity * 0.12),
      healthcare: round(equity * 0.13),
      international: round(international),
      rates: round(bonds + cash * 0.25),
    };
    const exposures = {
      marketBeta: round((equity + international * 0.85 + bonds * 0.15) / 100),
      sector,
      growthValue: round(equity * 0.18),
      largeSmall: round(equity * 0.82),
      duration: round(bonds * 0.07),
      inflationSensitivity: round(equity * 0.25 - bonds * 0.18),
      currency: { USD: round(100 - international), nonUSD: round(international) },
      commodity: round(equity * 0.03),
    };
    const riskContributions = [
      { factor: "equity_beta", contributionPct: round(equity * 0.65) },
      { factor: "rates_duration", contributionPct: round(bonds * 0.4) },
      { factor: "currency", contributionPct: round(international * 0.25) },
      { factor: "cash_drag", contributionPct: round(cash * 0.08) },
    ];

    return {
      generatedAt: now.toISOString(),
      portfolioId: portfolio.id,
      exposures,
      riskContributions,
      concentrationWarnings: [
        exposures.marketBeta > 0.8 ? "Market beta is high for a foundation-stage paper account." : null,
        Math.max(...Object.values(sector)) > 35 ? "One factor/sector sleeve contributes more than 35% exposure." : null,
      ].filter((item): item is string => Boolean(item)),
    };
  }
}

export class MonteCarloSimulationService {
  run(portfolio: PaperPortfolio, now = new Date(), simulationCount = 1000, horizonMonths = 24): MonteCarloSimulationReport {
    const monthlyReturn = portfolio.ytdReturnPct / 100 / 12;
    const monthlyVol = Math.max(0.018, portfolio.riskScore / 100 / Math.sqrt(12) * 0.16);
    const endings: number[] = [];
    const drawdowns: number[] = [];
    const bands = Array.from({ length: horizonMonths }, (_, month) => ({ month: month + 1, values: [] as number[] }));

    for (let sim = 0; sim < simulationCount; sim += 1) {
      let value = portfolio.totalValue;
      let peak = value;
      let maxDrawdown = 0;
      for (let month = 0; month < horizonMonths; month += 1) {
        const shock = deterministicNormal(sim, month) * monthlyVol;
        value *= 1 + monthlyReturn + shock;
        peak = Math.max(peak, value);
        maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100);
        bands[month].values.push(value);
      }
      endings.push(value);
      drawdowns.push(maxDrawdown);
    }

    const sortedEndings = [...endings].sort((a, b) => a - b);
    const sortedDrawdowns = [...drawdowns].sort((a, b) => a - b);
    const losses = endings.filter((value) => value < portfolio.totalValue);
    const var95 = portfolio.totalValue - percentile(sortedEndings, 5);
    const cvar95 = portfolio.totalValue - average(sortedEndings.slice(0, Math.max(1, Math.floor(sortedEndings.length * 0.05))));

    return {
      generatedAt: now.toISOString(),
      portfolioId: portfolio.id,
      simulationCount,
      horizonMonths,
      probabilityOfLossPct: round(losses.length / simulationCount * 100),
      valueAtRisk95: roundCurrency(var95),
      conditionalValueAtRisk95: roundCurrency(cvar95),
      medianEndingValue: roundCurrency(percentile(sortedEndings, 50)),
      worstCaseEndingValue: roundCurrency(sortedEndings[0]),
      drawdownDistribution: [50, 75, 90, 95].map((p) => ({ percentile: p, drawdownPct: round(percentile(sortedDrawdowns, p)) })),
      confidenceBands: bands.map((band) => {
        const sorted = band.values.sort((a, b) => a - b);
        return {
          month: band.month,
          p10: roundCurrency(percentile(sorted, 10)),
          p50: roundCurrency(percentile(sorted, 50)),
          p90: roundCurrency(percentile(sorted, 90)),
        };
      }),
      estimatedRecoveryMonths: Math.max(1, Math.round(percentile(sortedDrawdowns, 75) / 2)),
      stressSummary: [
        "Simulation uses deterministic demo return shocks, not live forecasts.",
        "Risk Officer and human review remain required before paper tickets.",
      ],
    };
  }
}

export class StressTestEngine {
  run(portfolio: PaperPortfolio, now = new Date()): StressTestReport {
    const scenarioLosses = [
      ["2008", "2008 financial crisis", -31],
      ["covid_crash", "2020 COVID crash", -22],
      ["2022_inflation_shock", "2022 inflation shock", -18],
      ["oil_shock", "Oil shock", -9],
      ["flash_crash", "Flash crash", -12],
      ["rate_spike", "Rate spike", -11],
      ["regional_banking_crisis", "Regional banking crisis", -8],
    ] as const;
    const equityPct = allocation(portfolio, ["VTI", "SPY", "QQQ", "VXUS"]);
    const bondPct = allocation(portfolio, ["BND", "AGG", "TLT", "IEF"]);
    const cashPct = portfolio.cash / portfolio.totalValue * 100 + allocation(portfolio, ["SGOV"]);
    const scenarios = scenarioLosses.map(([id, label, baseLoss]) => {
      const estimatedLossPct = round(baseLoss * (equityPct / 70) + Math.min(0, baseLoss * 0.25) * (bondPct / 30) + Math.abs(baseLoss) * 0.05 * (cashPct / 20));
      return {
        id,
        label,
        estimatedLossPct,
        estimatedLossValue: roundCurrency(portfolio.totalValue * estimatedLossPct / 100),
        estimatedDrawdownPct: Math.abs(estimatedLossPct),
        survivalScore: clamp(100 - Math.abs(estimatedLossPct) * 2),
        assetBehavior: [`Equity sleeve shock estimate: ${round(baseLoss * equityPct / 70)}%.`, `Bond/cash ballast allocation: ${round(bondPct + cashPct)}%.`],
      };
    });
    const worst = scenarios.reduce((left, right) => left.estimatedLossPct < right.estimatedLossPct ? left : right);

    return {
      generatedAt: now.toISOString(),
      portfolioId: portfolio.id,
      scenarios,
      worstScenario: worst.label,
      requiredActions: worst.survivalScore < 55 ? ["Reduce equity beta or add cash ballast before increasing paper risk."] : ["Continue monitoring scenario losses before new tickets."],
    };
  }
}

export class GreeksEngine {
  analyze(underlying = "SPY", underlyingPrice = 548.32, now = new Date()): GreeksReport {
    const positionGreeks = {
      delta: 42,
      gamma: 3.8,
      theta: -18.5,
      vega: 61,
      rho: 7.4,
    };
    const payoffPoints = Array.from({ length: 9 }, (_, index) => {
      const price = roundCurrency(underlyingPrice * (0.84 + index * 0.04));
      return { underlyingPrice: price, payoff: roundCurrency((price - underlyingPrice) * positionGreeks.delta - 140) };
    });

    return {
      generatedAt: now.toISOString(),
      underlying,
      positionGreeks,
      portfolioGreeks: { ...positionGreeks, delta: positionGreeks.delta * 0.2, gamma: positionGreeks.gamma * 0.2, theta: positionGreeks.theta * 0.2, vega: positionGreeks.vega * 0.2, rho: positionGreeks.rho * 0.2 },
      assignmentRisk: "Demo position is treated as defined-risk; assignment review still required before paper options workflows.",
      volatilityExposure: "Positive vega means implied-volatility compression can hurt the paper position.",
      payoffPoints,
      riskSummary: ["Options analytics are simulation-only.", "No live options execution path is enabled.", "Undefined-risk strategies remain blocked."],
    };
  }
}

export class RegimeDetectionService {
  classify(overview: MarketPilotOverview, now = new Date()): RegimeReport {
    const riskRulesWarning = overview.riskRules.some((rule) => rule.status !== "active");
    const highRiskScore = overview.portfolio.riskScore > 45;
    const primaryRegime = riskRulesWarning || highRiskScore ? "risk_off" : "rising_rate";
    return {
      generatedAt: now.toISOString(),
      primaryRegime,
      confidence: highRiskScore ? 76 : 68,
      supportingEvidence: [
        `Portfolio risk score is ${overview.portfolio.riskScore}/100.`,
        "Demo macro explanations emphasize front-end rates and dollar pressure.",
        `${overview.riskRules.length} risk rules are tracked before ticket approval.`,
      ],
      contradictoryEvidence: [
        overview.portfolio.cash > overview.portfolio.totalValue * 0.05 ? "Cash allocation reduces full risk-off sensitivity." : "Low cash would amplify drawdowns.",
      ],
      affectedAssetClasses: ["stocks", "ETFs", "bonds", "forex", "cash"],
    };
  }
}

export class AgentConsensusService {
  evaluate(agents: AgentOutput[], now = new Date()): AgentConsensusReport {
    const confidences = agents.map((agent) => agent.confidence);
    const dispersion = Math.max(...confidences) - Math.min(...confidences);
    const actionAgents = agents.filter((agent) => ["blocked", "action_required"].includes(agent.status));
    return {
      generatedAt: now.toISOString(),
      consensusScore: clamp(100 - dispersion - actionAgents.length * 4),
      confidenceScore: Math.round(average(confidences)),
      agreement: agents.filter((agent) => agent.status === "clear" || agent.status === "watch").map((agent) => `${agent.title}: ${agent.status}`),
      disagreement: actionAgents.map((agent) => `${agent.title}: ${agent.summary}`),
      confidenceDispersion: dispersion,
      minorityOpinions: actionAgents.length > 0 ? actionAgents.map((agent) => agent.title) : ["No major minority blocker in current agent set."],
      conflictingEvidence: agents.flatMap((agent) => agent.risks).slice(0, 6),
    };
  }
}

export class BehavioralIntelligenceService {
  evaluate(overview: MarketPilotOverview, now = new Date()): BehavioralIntelligenceReport {
    const text = overview.journalEntries.map((entry) => entry.notes.toLowerCase()).join(" ");
    const detectedPatterns: BehavioralIntelligenceReport["detectedPatterns"] = [
      text.includes("frustrated") || text.includes("revenge") ? "revenge_trading" : null,
      text.includes("missed") || text.includes("chase") ? "fomo" : null,
      text.includes("overconfident") ? "overconfidence" : null,
      overview.tradeTickets.some((ticket) => ticket.riskCheck.decision === "cooling_off") ? "position_chasing" : null,
      text.includes("new strategy") ? "strategy_hopping" : null,
      text.includes("avoid loss") ? "loss_aversion" : null,
      text.includes("last trade") ? "recency_bias" : null,
    ].filter((item): item is BehavioralIntelligenceReport["detectedPatterns"][number] => Boolean(item));
    const psychology = overview.proficiencyScores.find((score) => score.category === "trading_psychology")?.score ?? 50;
    return {
      generatedAt: now.toISOString(),
      behavioralScore: clamp(psychology - detectedPatterns.length * 8),
      detectedPatterns,
      coolingOffRecommendations: detectedPatterns.length > 0 ? ["Require a cooling-off review before the next paper ticket."] : ["No cooling-off requirement from current journal sample."],
      learningSuggestions: ["Review position sizing journal prompts.", "Explain invalidation before increasing risk."],
      riskPenalties: detectedPatterns.map((pattern) => `${pattern.replace("_", " ")} reduces ticket confidence until reviewed.`),
    };
  }
}

export class ProficiencyGraphService {
  build(overview: MarketPilotOverview, now = new Date()): ProficiencyGraphReport {
    const nodes = overview.proficiencyScores.map((score) => ({
      id: score.category,
      label: score.label,
      score: score.score,
      mastery: score.score >= 85 ? "advanced" as const : score.score >= 70 ? "proficient" as const : score.score >= 55 ? "developing" as const : "weak" as const,
      mistakes: score.evidence.filter((item) => /mistake|remediation|cooling|risk/i.test(item)).slice(0, 3),
    }));
    const edges: ProficiencyGraphReport["edges"] = [
      { from: "market_basics", to: "stocks", relationship: "prerequisite" },
      { from: "market_basics", to: "etfs", relationship: "prerequisite" },
      { from: "risk_management", to: "execution_mechanics", relationship: "dependency" },
      { from: "trading_psychology", to: "risk_management", relationship: "mastery_supports" },
      { from: "options", to: "execution_mechanics", relationship: "dependency" },
      { from: "portfolio_construction", to: "risk_management", relationship: "mastery_supports" },
    ];
    const weak = nodes.filter((node) => node.mastery === "weak" || node.mastery === "developing");
    const strong = nodes.filter((node) => node.mastery === "proficient" || node.mastery === "advanced");
    return {
      generatedAt: now.toISOString(),
      nodes,
      edges,
      adaptiveRecommendations: weak.slice(0, 4).map((node) => `Prioritize ${node.label} before next unlock review.`),
      unlockReadiness: overview.progression.requirementsToAdvance,
      weaknessMap: weak.map((node) => `${node.label}: ${node.score}/100`),
      strengthMap: strong.map((node) => `${node.label}: ${node.score}/100`),
    };
  }
}

export class InstitutionalAnalyticsService {
  readonly correlation = new CorrelationEngine();
  readonly factors = new FactorExposureService();
  readonly monteCarlo = new MonteCarloSimulationService();
  readonly stress = new StressTestEngine();
  readonly greeks = new GreeksEngine();
  readonly regime = new RegimeDetectionService();
  readonly consensus = new AgentConsensusService();
  readonly behavior = new BehavioralIntelligenceService();
  readonly proficiencyGraph = new ProficiencyGraphService();

  snapshot(overview: MarketPilotOverview, now = new Date()): InstitutionalAnalyticsSnapshot {
    const agents = agentOrchestrationService.generateOutputs(overview, now);
    const regime = this.regime.classify(overview, now);
    const consensus = this.consensus.evaluate(agents, now);
    const verification = verificationQualityService.evaluate(overview, now);
    return {
      generatedAt: now.toISOString(),
      crossAsset: this.correlation.analyze(overview.portfolio, now),
      factors: this.factors.analyze(overview.portfolio, now),
      monteCarlo: this.monteCarlo.run(overview.portfolio, now),
      stress: this.stress.run(overview.portfolio, now),
      greeks: this.greeks.analyze("SPY", 548.32, now),
      regime: { ...regime, supportingEvidence: [...regime.supportingEvidence, `Verification quality score is ${verification.score}.`] },
      consensus,
      behavior: this.behavior.evaluate(overview, now),
      proficiencyGraph: this.proficiencyGraph.build(overview, now),
    };
  }
}

export const institutionalAnalyticsService = new InstitutionalAnalyticsService();

function classify(symbol: string): AssetClass {
  const upper = symbol.toUpperCase();
  if (["BND", "AGG", "TLT", "IEF", "US2Y"].includes(upper)) return "bonds";
  if (["DXY", "EURUSD"].includes(upper)) return "forex";
  if (["OIL", "GLD", "DBC"].includes(upper)) return "commodities";
  if (["SGOV", "BIL", "SHV", "CASH"].includes(upper)) return "cash";
  return upper.includes("X") ? "etfs" : "stocks";
}

function relationshipFor(left: string, right: string) {
  const l = classify(left);
  const r = classify(right);
  if (l === r) return 0.82;
  if ((l === "stocks" || l === "etfs") && r === "forex") return -0.42;
  if (l === "forex" && (r === "stocks" || r === "etfs")) return -0.42;
  if ((l === "stocks" || l === "etfs") && r === "bonds") return 0.22;
  if (l === "bonds" && (r === "stocks" || r === "etfs")) return 0.22;
  if (l === "commodities" && r === "forex") return -0.35;
  return 0.18;
}

function regimeSensitivity(left: string, right: string) {
  const classes = [classify(left), classify(right)];
  return [
    classes.includes("bonds") ? "rising-rate" : null,
    classes.includes("commodities") ? "inflation" : null,
    classes.includes("forex") ? "dollar-strength" : null,
    classes.includes("stocks") || classes.includes("etfs") ? "risk-on/risk-off" : null,
  ].filter((item): item is string => Boolean(item));
}

function allocation(portfolio: PaperPortfolio, symbols: string[]) {
  return portfolio.holdings
    .filter((holding) => symbols.includes(holding.symbol.toUpperCase()))
    .reduce((sum, holding) => sum + holding.allocation, 0);
}

function pairs<T>(items: T[]): Array<[T, T]> {
  const result: Array<[T, T]> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      result.push([items[left], items[right]]);
    }
  }
  return result;
}

function deterministicNormal(sim: number, month: number) {
  const x = Math.sin((sim + 1) * 12.9898 + (month + 1) * 78.233) * 43758.5453;
  const uniform = x - Math.floor(x);
  return (uniform - 0.5) * 2;
}

function percentile(sorted: number[], p: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
