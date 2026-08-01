import type { MarketEvent } from "./eventCalendarService";

export type EventImpactScoreComponents = {
  sourceImportance: number;
  historicalVolatilityReaction: number;
  instrumentCoverage: number;
  surprisePotential: number;
  liquidityTimingRisk: number;
  policyOrSystemicImportance: number;
  confidence: number;
};

export type EventImpactScore = {
  finalScore: number;
  components: EventImpactScoreComponents;
  scoringVersion: "fincoach.event-impact.v1";
  affectedInstruments: string[];
  explanation: string;
  sourceTimestamps: string[];
  confidence: number;
  method: "rule-derived";
};

export class MarketEventImpactScoringService {
  score(event: MarketEvent, configuredSymbols: string[], now = new Date()): EventImpactScore {
    const related = event.relatedAssets ?? [];
    const affected = configuredSymbols.filter((symbol) => related.map(normalize).includes(normalize(symbol)));
    const base = event.impact === "high" ? 8 : event.impact === "medium" ? 5 : 2;
    const categoryBoost = event.category === "central_bank" ? 1 : event.category === "macro" ? 1 : 0;
    const broadCoverage = related.length >= 5 ? 2 : related.length >= 2 ? 1 : 0;
    const configuredCoverage = affected.length > 0 ? 1 : 0;
    const hoursUntil = Math.max(0, (Date.parse(event.startsAt) - now.getTime()) / 3_600_000);
    const timing = hoursUntil <= 2 ? 2 : hoursUntil <= 24 ? 1 : 0;
    const components: EventImpactScoreComponents = {
      sourceImportance: clamp(base, 1, 10),
      historicalVolatilityReaction: clamp(event.impact === "high" ? 8 : event.impact === "medium" ? 5 : 2, 1, 10),
      instrumentCoverage: clamp(2 + broadCoverage + configuredCoverage, 1, 10),
      surprisePotential: clamp(event.category === "macro" || event.category === "central_bank" ? 7 : 4, 1, 10),
      liquidityTimingRisk: clamp(3 + timing, 1, 10),
      policyOrSystemicImportance: clamp(event.category === "central_bank" ? 8 : event.category === "macro" ? 6 : 3, 1, 10),
      confidence: 5,
    };
    const weighted = (
      components.sourceImportance * 0.2
      + components.historicalVolatilityReaction * 0.2
      + components.instrumentCoverage * 0.15
      + components.surprisePotential * 0.15
      + components.liquidityTimingRisk * 0.1
      + components.policyOrSystemicImportance * 0.15
      + components.confidence * 0.05
      + categoryBoost
    );
    const finalScore = clamp(Math.round(weighted), 1, 10);
    return {
      finalScore,
      components,
      scoringVersion: "fincoach.event-impact.v1",
      affectedInstruments: affected,
      explanation: `Rule-derived score from event impact=${event.impact}, category=${event.category}, related assets=${related.length}, configured overlap=${affected.length}.`,
      sourceTimestamps: [event.startsAt],
      confidence: components.confidence,
      method: "rule-derived",
    };
  }
}

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export const marketEventImpactScoringService = new MarketEventImpactScoringService();
