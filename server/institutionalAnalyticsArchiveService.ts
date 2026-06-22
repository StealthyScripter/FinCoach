import type { InstitutionalAnalyticsSnapshot, MarketPilotOverview, MarketPilotEvent } from "@shared/schema";
import { eventLogService } from "./eventLogService";

export class InstitutionalAnalyticsArchiveService {
  record(snapshot: InstitutionalAnalyticsSnapshot, overview: MarketPilotOverview) {
    const payload = {
      regime: snapshot.regime.primaryRegime,
      confidence: snapshot.regime.confidence,
      consensusScore: snapshot.consensus.consensusScore,
      behavioralScore: snapshot.behavior.behavioralScore,
      monteCarloLossProbability: snapshot.monteCarlo.probabilityOfLossPct,
      factorWarnings: snapshot.factors.concentrationWarnings,
      stressWorstScenario: snapshot.stress.worstScenario,
      greekDelta: snapshot.greeks.portfolioGreeks.delta,
      portfolioValue: overview.portfolio.totalValue,
      portfolioRiskScore: overview.portfolio.riskScore,
    };

    return eventLogService.append({
      type: "analytics.snapshot_recorded",
      userId: overview.user.id,
      sourceService: "institutional-analytics-service",
      payload,
    });
  }

  latest(limit = 10): MarketPilotEvent[] {
    return eventLogService
      .list(250)
      .filter((event) => event.type === "analytics.snapshot_recorded")
      .slice(0, limit);
  }
}

export const institutionalAnalyticsArchiveService = new InstitutionalAnalyticsArchiveService();
