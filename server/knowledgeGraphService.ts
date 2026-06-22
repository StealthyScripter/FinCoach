import { randomUUID } from "crypto";
import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphReport, MarketPilotOverview } from "@shared/schema";
import { predictionReviewService } from "./predictionReviewService";

export class KnowledgeGraphService {
  build(overview: MarketPilotOverview, startNodeId: string | null = null, now = new Date()): KnowledgeGraphReport {
    const nodes: KnowledgeGraphNode[] = [];
    const edges: KnowledgeGraphEdge[] = [];
    const addNode = (node: KnowledgeGraphNode) => {
      if (!nodes.some((item) => item.id === node.id)) nodes.push(node);
    };
    const addEdge = (edge: Omit<KnowledgeGraphEdge, "id" | "timestamp">) => {
      edges.push({ ...edge, id: randomUUID(), timestamp: now.toISOString() });
    };

    for (const holding of overview.portfolio.holdings) {
      addNode({
        id: `asset-${holding.symbol}`,
        type: "Asset",
        label: holding.symbol,
        timestamp: now.toISOString(),
        confidence: 80,
        sourceCount: 1,
        metadata: { allocation: holding.allocation, riskContribution: holding.riskContribution },
      });
    }

    for (const report of overview.researchReports) {
      const reportId = `research-${report.id}`;
      addNode({
        id: reportId,
        type: "ResearchReport",
        label: report.title,
        timestamp: report.generatedAt,
        confidence: report.confidence,
        sourceCount: report.verification.sources.length,
        verificationStatus: report.verification.status,
        metadata: { agent: report.agent, classification: report.classification },
      });
      if (report.asset) {
        addNode({
          id: `asset-${report.asset}`,
          type: "Asset",
          label: report.asset,
          timestamp: report.generatedAt,
          confidence: 75,
          sourceCount: report.verification.sources.length,
          metadata: {},
        });
        addEdge({ from: reportId, to: `asset-${report.asset}`, type: "references", confidence: report.confidence });
      }
      for (const contradiction of report.verification.contradictoryEvidence) {
        const nodeId = `risk-${hashish(contradiction)}`;
        addNode({
          id: nodeId,
          type: "RiskEvent",
          label: contradiction,
          timestamp: report.generatedAt,
          confidence: report.verification.confidence,
          sourceCount: report.verification.sources.length,
          verificationStatus: report.verification.status,
          metadata: {},
        });
        addEdge({ from: nodeId, to: reportId, type: "contradicts", confidence: report.verification.confidence });
      }
    }

    for (const ticket of overview.tradeTickets) {
      const decisionId = `agent-decision-${ticket.riskCheck.id}`;
      addNode({
        id: decisionId,
        type: "AgentDecision",
        label: `${ticket.asset} risk decision: ${ticket.riskCheck.decision}`,
        timestamp: ticket.riskCheck.checkedAt,
        confidence: ticket.riskCheck.score,
        sourceCount: ticket.verification.sources.length,
        verificationStatus: ticket.verification.status,
        metadata: { ticketId: ticket.id, status: ticket.status },
      });
      addNode({
        id: `asset-${ticket.asset}`,
        type: "Asset",
        label: ticket.asset,
        timestamp: ticket.createdAt,
        confidence: ticket.confidence,
        sourceCount: ticket.verification.sources.length,
        metadata: {},
      });
      addEdge({ from: decisionId, to: `asset-${ticket.asset}`, type: "affects", confidence: ticket.riskCheck.score });
    }

    for (const entry of overview.journalEntries) {
      addNode({
        id: `journal-${entry.id}`,
        type: "TradeJournal",
        label: entry.title,
        timestamp: entry.createdAt,
        confidence: entry.qualityScore,
        sourceCount: 1,
        metadata: { linkedTicketId: entry.linkedTicketId ?? null },
      });
      for (const lesson of entry.lessons) {
        const lessonId = `lesson-${hashish(lesson)}`;
        addNode({
          id: lessonId,
          type: "LessonLearned",
          label: lesson,
          timestamp: entry.createdAt,
          confidence: entry.qualityScore,
          sourceCount: 1,
          metadata: {},
        });
        addEdge({ from: lessonId, to: `journal-${entry.id}`, type: "learned_from", confidence: entry.qualityScore });
      }
    }

    for (const review of predictionReviewService.listReviews()) {
      const reviewNodeId = `prediction-review-${review.predictionId}`;
      const lessonNodeId = `prediction-lesson-${review.predictionId}`;
      addNode({
        id: reviewNodeId,
        type: "AgentDecision",
        label: `Prediction review: ${review.predictionId}`,
        timestamp: review.reviewedAt,
        confidence: review.confidence,
        sourceCount: review.whatWasMissed.length,
        metadata: {
          reviewId: review.id,
          updatedLesson: review.updatedLesson,
          futureRuleAdjustment: review.futureRuleAdjustment,
        },
      });
      addNode({
        id: lessonNodeId,
        type: "LessonLearned",
        label: review.updatedLesson,
        timestamp: review.reviewedAt,
        confidence: review.confidence,
        sourceCount: review.whatWasMissed.length,
        metadata: { predictionId: review.predictionId, reviewId: review.id },
      });
      addEdge({ from: reviewNodeId, to: lessonNodeId, type: "learned_from", confidence: review.confidence });
    }

    const traversalStart = startNodeId && nodes.some((node) => node.id === startNodeId) ? startNodeId : nodes[0]?.id ?? null;
    const visited = traversalStart ? traverse(traversalStart, edges, 12) : [];

    return {
      generatedAt: now.toISOString(),
      nodes,
      edges,
      traversal: {
        startNodeId: traversalStart,
        visitedNodeIds: visited,
        pathSummaries: visited.map((nodeId) => nodes.find((node) => node.id === nodeId)?.label ?? nodeId),
      },
    };
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();

function traverse(start: string, edges: KnowledgeGraphEdge[], limit: number) {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length && seen.size < limit) {
    const node = queue.shift() as string;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of edges.filter((item) => item.from === node || item.to === node)) {
      queue.push(edge.from === node ? edge.to : edge.from);
    }
  }
  return Array.from(seen);
}

function hashish(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 42);
}
