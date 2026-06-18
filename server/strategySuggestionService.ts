import { randomUUID } from "crypto";
import type { MarketMovementExplanation, MarketPilotOverview, StrategySuggestion } from "@shared/schema";

export class StrategySuggestionService {
  suggest({
    prompt,
    explanation,
    overview,
  }: {
    prompt: string;
    explanation: MarketMovementExplanation;
    overview: MarketPilotOverview;
  }): StrategySuggestion {
    const wantsShort = /\b(short|put|bear|downside)\b/i.test(prompt);
    const wantsOptions = /\b(option|put|call|spread)\b/i.test(prompt);
    const weakEvidence = explanation.confidence < 70 || explanation.contradictoryEvidence.length > 1;
    const optionsScore = overview.proficiencyScores.find((score) => score.category === "options")?.score ?? 0;
    const riskDecision = weakEvidence
      ? "require_more_research"
      : wantsOptions && optionsScore < 70
        ? "require_quiz"
        : "reduce_size";

    return {
      id: `strategy-${randomUUID()}`,
      situationSummary: explanation.mainCause,
      possibleStrategy: weakEvidence
        ? "Avoid trade or wait for confirmation"
        : wantsShort
          ? "Defined-risk bearish paper setup"
          : "Small paper position after confirmation",
      whyItMightWork: [
        explanation.mainCause,
        ...explanation.whatWouldStrengthen.slice(0, 2),
      ],
      whyItMightFail: [
        ...explanation.contradictoryEvidence,
        explanation.whatWouldInvalidate,
      ].slice(0, 4),
      bestInstrument: wantsOptions
        ? optionsScore >= 70 ? "Defined-risk option spread" : "Paper stock or ETF proxy until options proficiency improves"
        : wantsShort ? "Small paper short stock or inverse/sector ETF hedge" : "Paper stock or diversified ETF",
      entryLogic: "Enter only after the confirming signal appears and the thesis is written in the journal.",
      exitLogic: "Exit if the catalyst fades, confirmation reverses, or the time horizon expires.",
      stopLossLogic: "Use a predefined stop that keeps estimated loss inside the configured risk-per-trade limit.",
      positionSize: `Start below ${overview.riskSettings.reduceSizeAbovePct.toFixed(2)}% portfolio risk; reduce further if confidence is below 75%.`,
      riskReward: "Only acceptable if expected reward is at least twice the predefined loss and evidence remains verified.",
      timeHorizon: "Days to weeks; reassess after the next material data point.",
      confidence: Math.max(0, Math.min(100, explanation.confidence - (weakEvidence ? 12 : 4))),
      requiredConfirmation: [
        "Fresh price action confirms the thesis.",
        "Contradictory evidence does not strengthen.",
        "Risk officer does not reject the idea.",
      ],
      saferAlternatives: [
        "Avoid trade.",
        "Wait for confirmation.",
        "Use a smaller paper position.",
        "Use an ETF hedge instead of single-name exposure.",
      ],
      riskOfficerDecision: riskDecision,
    };
  }
}

export const strategySuggestionService = new StrategySuggestionService();
