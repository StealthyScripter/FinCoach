import type { ProficiencyScore, RiskCheck, RiskSettings, TicketStatus, TradeTicketProposal } from "@shared/schema";
import { randomUUID } from "crypto";
import type { MarketEvent } from "./eventCalendarService";

export type TicketRiskEvaluation = {
  riskAmount: number;
  riskPct: number;
  riskCheck: RiskCheck;
  status: TicketStatus;
  confidence: number;
  portfolioImpact: string;
};

export type BehavioralRiskSignal = {
  tradingPsychologyScore?: number;
  recentJournalQuality?: number;
  mistakePatterns?: string[];
  disciplineSignals?: string[];
};

export function evaluateTradeTicketRisk({
  proposal,
  portfolioValue,
  liveTradingEnabled,
  proficiencyScores,
  eventRisks = [],
  behavioralRisk,
  checkedAt = new Date().toISOString(),
  riskSettings,
}: {
  proposal: TradeTicketProposal;
  portfolioValue: number;
  liveTradingEnabled: boolean;
  proficiencyScores: ProficiencyScore[];
  eventRisks?: MarketEvent[];
  behavioralRisk?: BehavioralRiskSignal;
  checkedAt?: string;
  riskSettings?: RiskSettings;
}): TicketRiskEvaluation {
  const maxRiskPerTradePct = riskSettings?.maxRiskPerTradePct ?? 1;
  const reduceSizeAbovePct = riskSettings?.reduceSizeAbovePct ?? 0.5;
  const notional = proposal.quantity * proposal.entryPrice;
  const stopDistance = proposal.stopLoss
    ? Math.abs(proposal.entryPrice - proposal.stopLoss) * proposal.quantity
    : notional * 0.01;
  const riskPct = portfolioValue > 0 ? (stopDistance / portfolioValue) * 100 : 100;
  const isOption = /\b(call|put|option|spread)\b/i.test(proposal.asset);
  const optionsScore =
    proficiencyScores.find((score) => score.category === "options")?.score ?? 0;
  const emotionalRisk = evaluateBehavioralRisk(behavioralRisk);

  const decision =
    eventRisks.length > 0 || emotionalRisk.coolingOff
      ? "cooling_off"
      : isOption && optionsScore < 70
      ? "require_quiz"
      : riskPct > maxRiskPerTradePct
        ? "reject"
        : riskPct > reduceSizeAbovePct
          ? "reduce_size"
          : "approve";

  let riskScore = 86;
  if (eventRisks.length > 0 || emotionalRisk.coolingOff) {
    riskScore = 36;
  } else if (riskPct > maxRiskPerTradePct || (isOption && optionsScore < 70)) {
    riskScore = 24;
  } else if (riskPct > reduceSizeAbovePct) {
    riskScore = 58;
  }

  const reasons = [
    `Estimated ticket risk is ${riskPct.toFixed(2)}% of the paper portfolio.`,
    `Configured risk thresholds: reduce above ${reduceSizeAbovePct.toFixed(2)}%, reject above ${maxRiskPerTradePct.toFixed(2)}%.`,
    liveTradingEnabled
      ? "Live trading flag is enabled."
      : "Live trading remains disabled; this can only become a paper ticket.",
  ];

  if (isOption && optionsScore < 70) {
    reasons.push("Options proficiency is below the simulation unlock threshold.");
  }

  for (const event of eventRisks) {
    reasons.push(`Major event risk: ${event.title} at ${event.startsAt}. ${event.riskNote}`);
  }

  for (const reason of emotionalRisk.reasons) {
    reasons.push(reason);
  }

  return {
    riskAmount: Number(stopDistance.toFixed(2)),
    riskPct,
    status: decision === "approve" ? "proposed" : "risk_rejected",
    confidence: decision === "approve" ? 68 : 42,
    portfolioImpact: `Estimated notional impact is $${notional.toFixed(2)} before fees and slippage.`,
    riskCheck: {
      id: randomUUID(),
      decision,
      score: riskScore,
      reasons,
      requiredActions:
        decision === "approve"
          ? ["Complete journal rationale before paper fill", "Confirm this is paper-only"]
          : decision === "cooling_off"
            ? [
                eventRisks.length > 0
                  ? "Wait until the major event passes or explicitly document event-risk approval"
                  : "Complete a cooling-off journal review before submitting another ticket",
                ...emotionalRisk.requiredActions,
              ]
          : ["Reduce size or complete the required proficiency gate"],
      checkedAt,
    },
  };
}

function evaluateBehavioralRisk(signal?: BehavioralRiskSignal) {
  const mistakePatterns = signal?.mistakePatterns ?? [];
  const reasons: string[] = [];
  const requiredActions: string[] = [];

  if (signal?.recentJournalQuality !== undefined && signal.recentJournalQuality < 50) {
    reasons.push(`Recent journal quality is ${signal.recentJournalQuality}/100, below the discipline gate.`);
    requiredActions.push("Submit a higher-quality journal review that explains plan, sizing, stop, and lessons learned");
  }

  const emotionalPatterns = mistakePatterns.filter((pattern) =>
    /\b(revenge|impulsive|overconfident|deviated|ignored|weak position sizing)\b/i.test(pattern),
  );

  if (emotionalPatterns.length > 0) {
    reasons.push(`Behavioral risk pattern detected: ${emotionalPatterns.join("; ")}.`);
    requiredActions.push("Observe a cooling-off period and document the next pre-trade plan before risk review");
  }

  if (signal?.tradingPsychologyScore !== undefined && signal.tradingPsychologyScore < 35) {
    reasons.push(`Trading psychology score is ${signal.tradingPsychologyScore}, below the minimum ticket gate.`);
    requiredActions.push("Improve trading psychology proficiency before submitting new tickets");
  }

  return {
    coolingOff: reasons.length > 0,
    reasons,
    requiredActions,
  };
}
