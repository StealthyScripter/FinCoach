import type { MarketMovementExplanation } from "@shared/schema";
import {
  MockMacroDataProvider,
  MockMarketDataProvider,
  MockNewsProvider,
  type MacroDataProvider,
  type MarketDataProvider,
  type NewsProvider,
} from "./marketProviders";

export class MarketMovementExplainer {
  constructor(
    private readonly marketData: MarketDataProvider = new MockMarketDataProvider(),
    private readonly macroData: MacroDataProvider = new MockMacroDataProvider(),
    private readonly news: NewsProvider = new MockNewsProvider(),
  ) {}

  async explain(symbol: string): Promise<MarketMovementExplanation> {
    const [quote, macro, news] = await Promise.all([
      this.marketData.getQuote(symbol),
      this.macroData.getMacroSnapshot(),
      this.news.getRelevantNews(symbol),
    ]);
    const isDown = quote.changePct < 0;
    const ratesPressure = macro.twoYearYieldChangeBps > 5;
    const dollarPressure = macro.dollarChangePct > 0.25;
    const reliableNewsCount = news.filter((item) => item.reliability === "high" || item.reliability === "medium").length;
    const facts = [
      `${quote.symbol} moved ${quote.changePct.toFixed(2)}% with ${quote.volumeTrend} volume.`,
      `2-year Treasury yield change was ${macro.twoYearYieldChangeBps} bps.`,
      `Dollar change was ${macro.dollarChangePct.toFixed(2)}%.`,
      `Macro policy-rate bias is ${macro.policyRateBias}.`,
      `${reliableNewsCount} medium-or-better source(s) were available in the demo news set.`,
    ];
    const interpretations = [
      ratesPressure
        ? "Front-end yield pressure is a credible primary driver of the move."
        : "Rates are not strong enough to fully explain the move alone.",
      dollarPressure
        ? "A firmer dollar is tightening financial conditions and can pressure risk assets."
        : "Dollar pressure is not the dominant driver in this explanation.",
      quote.volumeTrend === "rising"
        ? "Rising volume improves confidence that the move is being broadly repriced."
        : "Limited volume confirmation lowers confidence in the causal explanation.",
    ];
    const predictions = [
      "If yields and the dollar keep rising, rate-sensitive assets may remain under pressure.",
      "If the next macro print cools, the current explanation should lose confidence quickly.",
    ];
    const evidence = [
      ...facts,
      ...news.map((item) => `${item.source}: ${item.headline}`),
    ];
    const contradictoryEvidence = [
      macro.recessionRisk === "high"
        ? "High recession risk could shift the interpretation from inflation pressure to growth stress."
        : "Recession risk is not high enough in the demo macro snapshot to dominate the explanation.",
      news.some((item) => item.sentiment === "positive")
        ? "Positive news sentiment may be cushioning the downside or contradicting a purely negative thesis."
        : "No positive news item in the demo set materially contradicts the primary thesis.",
    ];
    const confidence = Math.min(
      90,
      55 +
        (ratesPressure ? 12 : 0) +
        (dollarPressure ? 8 : 0) +
        (quote.volumeTrend === "rising" ? 8 : 0) +
        (reliableNewsCount > 0 ? 7 : 0),
    );
    const primaryCause = isDown && ratesPressure
      ? `${quote.name} is lower primarily because front-end yields rose after a hotter macro signal.`
      : `${quote.name} is moving mainly on macro repricing and fresh news flow.`;
    const sourceTimestamps = [
      {
        name: "MarketPilot demo quote provider",
        timestamp: quote.timestamp,
        reliability: "medium" as const,
      },
      {
        name: "MarketPilot demo macro provider",
        timestamp: macro.timestamp,
        reliability: "medium" as const,
      },
      ...news.map((item) => ({
        name: item.source,
        timestamp: item.timestamp,
        reliability: item.reliability,
      })),
    ];
    const relatedAssets = Array.from(new Set(news.flatMap((item) => item.relatedSymbols)));
    const whatWouldInvalidate =
      "If yields and the dollar reverse while the asset continues in the same direction, another catalyst is likely responsible.";

    return {
      symbol: quote.symbol,
      primaryCause,
      mainCause: primaryCause,
      secondaryCauses: interpretations,
      facts,
      interpretations,
      predictions,
      evidence,
      confidence,
      contradictoryEvidence,
      whatWouldInvalidate,
      whatCouldReverse:
        "A reversal in front-end yields, cooler inflation data, or a credible dovish policy signal would weaken this explanation.",
      affectedAssets: relatedAssets,
      relatedAssets,
      riskFactors: [
        "Demo data may be delayed and should not be treated as live market data.",
        "Market causality is an interpretation, not a directly observable fact.",
        "Any trade idea based on this explanation still requires verification, risk, portfolio, compliance, and human approval.",
      ],
      whatWouldStrengthen: [
        "Sustained move in the same direction with rising volume.",
        "Fresh macro data confirming the rate and dollar interpretation.",
        "Multiple medium-or-better sources aligning with the same catalyst.",
      ],
      whatWouldWeaken: [
        "Yields or dollar reverse while the asset move persists.",
        "Company- or sector-specific news explains more of the move than macro inputs.",
        "Low volume or conflicting news undermines the causal chain.",
      ],
      alternativeExplanations: [
        "Positioning unwind after crowded exposure.",
        "Sector rotation unrelated to the headline macro catalyst.",
        "Options hedging flow amplifying the observed price move.",
      ],
      consensusScore: Math.max(0, Math.min(100, confidence - contradictoryEvidence.length * 5)),
      agentAgreementScore: Math.max(0, Math.min(100, confidence - (ratesPressure && dollarPressure ? 4 : 12))),
      historicalAnalogues: [
        "2022 inflation/rate shock",
        "FOMC repricing episodes",
      ],
      pastSimilarEvents: [
        "Hot inflation print lifted front-end yields and pressured duration-sensitive assets.",
        "Dollar strength coincided with broad risk-asset weakness.",
      ],
      scenarioProbabilities: [
        { scenario: "Rates-led repricing continues", probabilityPct: ratesPressure ? 48 : 28 },
        { scenario: "Move fades after cooler data", probabilityPct: 26 },
        { scenario: "Idiosyncratic catalyst dominates", probabilityPct: dollarPressure ? 18 : 30 },
      ],
      sourceTimestamps,
      verification: {
        id: `verify-${quote.symbol.toLowerCase()}-${Date.now()}`,
        status: confidence >= 80 ? "verified" : "partially_verified",
        confidence,
        evidenceSummary: evidence.join(" "),
        contradictoryEvidence,
        whatWouldDisprove: whatWouldInvalidate,
        sources: sourceTimestamps,
      },
    };
  }
}

export const marketMovementExplainer = new MarketMovementExplainer();
