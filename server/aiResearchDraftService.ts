import { randomUUID } from "crypto";
import type { MarketPilotOverview, ResearchReport } from "@shared/schema";
import { aiProvider } from "./aiProviderService";
import { aiEvaluationHarness, type AIEvaluationReport } from "./aiEvaluationHarness";
import { ragContextBuilder, type RetrievedContext } from "./ragService";
import { verificationQualityService } from "./verificationQualityService";

export type AIResearchDraftResult = {
  report: ResearchReport;
  ragContext: RetrievedContext;
  aiEvaluation: AIEvaluationReport;
  displayApproved: boolean;
  requiredActions: string[];
};

export class AIResearchDraftService {
  async generate(overview: MarketPilotOverview, symbol = "SPY", now = new Date()): Promise<AIResearchDraftResult> {
    const ragContext = await ragContextBuilder.build(overview, `${symbol} market thesis risk verification`);
    const ai = await aiProvider.reason<Record<string, unknown>>({
      prompt: `Draft a MarketPilot research report for ${symbol} using retrieved context.`,
      schemaName: "research_draft",
      promptVersion: "marketpilot-research-draft-v1",
      metadata: { symbol, contextCount: ragContext.chunks.length },
    });
    const output = ai.output;
    const citations = Array.isArray(output.citations) ? output.citations as ResearchReport["verification"]["sources"] : [];
    const confidence = typeof output.confidence === "number" ? output.confidence : 50;
    const report: ResearchReport = {
      id: `ai-draft-${symbol.toLowerCase()}-${randomUUID()}`,
      agent: "verification",
      title: `${symbol.toUpperCase()} AI-Assisted Research Draft`,
      asset: symbol.toUpperCase(),
      summary: String(output.thesis ?? "Demo AI research thesis."),
      mainCause: String(output.thesis ?? "Demo AI research thesis."),
      secondaryCauses: asStringArray(output.interpretations),
      riskFactors: asStringArray(output.riskFactors),
      classification: "interpretation",
      confidence,
      generatedAt: now.toISOString(),
      verification: {
        id: `verify-ai-draft-${randomUUID()}`,
        status: output.verificationStatus === "verified" ? "verified" : "partially_verified",
        confidence,
        evidenceSummary: asStringArray(output.supportingEvidence).join(" "),
        contradictoryEvidence: asStringArray(output.contradictoryEvidence),
        whatWouldDisprove: String(output.invalidationCriteria ?? "Contradictory fresh data would invalidate this draft."),
        sources: citations.length ? citations : ragContext.citations.map((citation) => ({
          name: citation.label,
          timestamp: citation.timestamp,
          reliability: "medium" as const,
        })),
      },
    };
    const evaluation = aiEvaluationHarness.evaluate({
      output,
      requiredFields: ["thesis", "facts", "interpretations", "predictions", "supportingEvidence", "contradictoryEvidence", "confidence", "citations", "riskFactors", "invalidationCriteria", "affectedAssets", "verificationStatus"],
      citations: report.verification.sources,
      confidence,
      safetyNotes: ai.safety.notes,
      contradictoryEvidence: report.verification.contradictoryEvidence,
    }, now);
    const verification = verificationQualityService.evaluate({ ...overview, researchReports: [report, ...overview.researchReports] }, now);
    const displayApproved = evaluation.overallScore >= 75 && verification.score >= 60;
    return {
      report,
      ragContext,
      aiEvaluation: evaluation,
      displayApproved,
      requiredActions: [...evaluation.requiredActions, ...verification.requiredActions],
    };
  }
}

export const aiResearchDraftService = new AIResearchDraftService();

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
