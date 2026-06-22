import type { KnowledgeGraphReport, MarketPilotOverview, MarketPilotEvent } from "@shared/schema";
import { eventLogService } from "./eventLogService";

export class KnowledgeGraphArchiveService {
  record(report: KnowledgeGraphReport, overview: MarketPilotOverview) {
    const snapshot = {
      nodeCount: report.nodes.length,
      edgeCount: report.edges.length,
      traversalStartNodeId: report.traversal.startNodeId,
      visitedNodeIds: report.traversal.visitedNodeIds,
      pathSummaries: report.traversal.pathSummaries,
      portfolioValue: overview.portfolio.totalValue,
      researchReportCount: overview.researchReports.length,
      tradeTicketCount: overview.tradeTickets.length,
      journalEntryCount: overview.journalEntries.length,
    };

    return eventLogService.append({
      type: "knowledge.graph_built",
      userId: overview.user.id,
      sourceService: "knowledge-graph-service",
      payload: snapshot,
    });
  }

  latest(limit = 10): MarketPilotEvent[] {
    return eventLogService
      .list(250)
      .filter((event) => event.type === "knowledge.graph_built")
      .slice(0, limit);
  }
}

export const knowledgeGraphArchiveService = new KnowledgeGraphArchiveService();
