import type { MarketMovementExplanation, ResearchReport } from "@shared/schema";
import { marketMovementExplainer, type MarketMovementExplainer } from "./marketMovementExplainer";

export class ResearchService {
  constructor(private readonly explainer: MarketMovementExplainer = marketMovementExplainer) {}

  async generateMarketBriefing(symbol = "SPY"): Promise<ResearchReport> {
    const explanation = await this.explainMove(symbol);
    const now = new Date().toISOString();

    return {
      id: `report-${symbol.toLowerCase()}-${Date.now()}`,
      agent: symbol.toUpperCase().includes("EUR") ? "forex" : "macro",
      title: `${symbol.toUpperCase()} Movement Briefing`,
      asset: symbol.toUpperCase(),
      summary: `${symbol.toUpperCase()} is being interpreted through rates, dollar, volume, and news alignment. ${explanation.mainCause}`,
      mainCause: explanation.mainCause,
      secondaryCauses: explanation.secondaryCauses,
      riskFactors: [
        "Data may be delayed in demo mode",
        "News causality is an interpretation, not a proven fact",
        "Position sizing must still pass the risk officer",
      ],
      classification: "interpretation",
      confidence: explanation.confidence,
      generatedAt: now,
      verification: explanation.verification,
    };
  }

  async explainMove(symbol: string): Promise<MarketMovementExplanation> {
    return this.explainer.explain(symbol);
  }
}

export const researchService = new ResearchService();
