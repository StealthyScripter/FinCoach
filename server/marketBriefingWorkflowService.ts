import type { ResearchReport, ScheduledMarketBriefing } from "@shared/schema";
import { researchService, type ResearchService } from "./researchService";

const defaultSymbols = ["SPY", "QQQ", "SGOV", "EURUSD"];

export class MarketBriefingWorkflowService {
  constructor(private readonly research: ResearchService = researchService) {}

  async run(symbols = defaultSymbols, now = new Date()): Promise<ScheduledMarketBriefing> {
    const generatedAt = now.toISOString();
    const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
    const reports = await Promise.all(normalizedSymbols.map((symbol) => this.research.generateMarketBriefing(symbol)));
    const staleSources = collectStaleSources(reports, generatedAt);
    const verificationSummary = {
      verified: reports.filter((report) => report.verification.status === "verified").length,
      partiallyVerified: reports.filter((report) => report.verification.status === "partially_verified").length,
      requiresReview: reports.filter((report) =>
        ["requires_human_review", "not_verified", "conflicting_evidence"].includes(report.verification.status),
      ).length,
    };

    return {
      id: `briefing-${generatedAt.slice(0, 10)}`,
      generatedAt,
      symbols: normalizedSymbols,
      reports,
      freshness: {
        maxSourceAgeMinutes: 30,
        staleSources,
      },
      verificationSummary,
      requiredActions: staleSources.length > 0 || verificationSummary.requiresReview > 0
        ? [
            "Review stale or weak sources before relying on briefing claims",
            "Downgrade unsupported claims to interpretation until refreshed",
          ]
        : ["Use briefing reports as paper-research inputs; execution remains gated by risk review"],
    };
  }
}

export const marketBriefingWorkflowService = new MarketBriefingWorkflowService();

function collectStaleSources(reports: ResearchReport[], generatedAt: string) {
  return reports.flatMap((report) =>
    report.verification.sources
      .filter((source) => minutesBetween(source.timestamp, generatedAt) > 30)
      .map((source) => `${report.asset ?? report.title}: ${source.name} source is older than 30 minutes`),
  );
}

function minutesBetween(leftIso: string, rightIso: string) {
  return Math.abs(new Date(rightIso).getTime() - new Date(leftIso).getTime()) / 60000;
}
