import { randomUUID } from "crypto";
import type { DecisionCard, MarketMoveInvestigation, MarketMovementExplanation } from "@shared/schema";
import { researchService, type ResearchService } from "./researchService";

export class MarketMoveInvestigationService {
  constructor(private readonly research: ResearchService = researchService) {}

  async investigate(symbol: string): Promise<MarketMoveInvestigation> {
    const explanation = await this.research.explainMove(normalizeSymbol(symbol));
    const decisionCard = buildDecisionCard(explanation);

    return {
      id: `investigation-${explanation.symbol.toLowerCase()}-${randomUUID()}`,
      asset: explanation.symbol,
      mainCause: explanation.mainCause,
      supportingEvidence: explanation.evidence.slice(0, 5),
      confidence: explanation.confidence,
      contradictoryEvidence: explanation.contradictoryEvidence,
      whatToWatchNext: [
        ...explanation.whatWouldStrengthen.slice(0, 2),
        "Whether price follows through or reverses on fresh volume.",
      ],
      tradeImplications: [
        "Treat this as research input, not a trade instruction.",
        explanation.confidence >= 75
          ? "A paper strategy can be considered only after risk and confirmation checks."
          : "Wait for stronger confirmation before converting this into a strategy.",
        "Live execution remains blocked.",
      ],
      facts: explanation.facts,
      interpretations: explanation.interpretations,
      whatWouldConfirm: explanation.whatWouldStrengthen,
      whatWouldDisprove: explanation.whatWouldInvalidate,
      decisionCard,
    };
  }
}

export const marketMoveInvestigationService = new MarketMoveInvestigationService();

export function buildDecisionCard(explanation: MarketMovementExplanation): DecisionCard {
  return {
    id: `decision-${explanation.symbol.toLowerCase()}-${Date.now()}`,
    title: `${explanation.symbol} Move Explained`,
    asset: explanation.symbol,
    situation: `${explanation.symbol} moved and MarketPilot separated facts, interpretations, and disproof criteria.`,
    mainConclusion: explanation.mainCause,
    confidence: explanation.confidence,
    suggestedAction: explanation.confidence >= 75
      ? "Watch for confirmation before considering a paper strategy."
      : "Do not trade yet; evidence is not strong enough.",
    riskLevel: explanation.confidence >= 80 ? "medium" : "high",
    why: explanation.evidence.slice(0, 4),
    whatCouldProveWrong: [explanation.whatWouldInvalidate, ...explanation.whatWouldWeaken.slice(0, 2)],
    learningNote: "Separate facts from interpretations, then define the signal that would disprove the thesis.",
    verificationStatus: explanation.verification.status,
    nextStep: "Check confirmation, contradictory evidence, and risk officer status before acting.",
    details: {
      facts: explanation.facts,
      interpretations: explanation.interpretations,
      contradictoryEvidence: explanation.contradictoryEvidence,
      risks: explanation.riskFactors,
      verificationStatus: explanation.verification.status,
      advancedAnalytics: [
        `Consensus score: ${explanation.consensusScore}`,
        `Agent agreement score: ${explanation.agentAgreementScore}`,
        ...explanation.scenarioProbabilities.map((item) => `${item.scenario}: ${item.probabilityPct}%`),
      ],
    },
  };
}

function normalizeSymbol(value: string) {
  const trimmed = value.trim().toUpperCase();
  if (/MICROSOFT|MSFT/.test(trimmed)) return "MSFT";
  if (/BOEING|BA/.test(trimmed)) return "BA";
  if (/EUR\/?USD/.test(trimmed)) return "EURUSD";
  if (/BITCOIN|BTC/.test(trimmed)) return "BTC";
  return trimmed.replace(/[^A-Z0-9]/g, "") || "SPY";
}
