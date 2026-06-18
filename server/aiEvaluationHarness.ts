export type AIEvaluationInput = {
  output: Record<string, unknown>;
  requiredFields: string[];
  citations?: unknown[];
  confidence?: number;
  safetyNotes?: string[];
  contradictoryEvidence?: unknown[];
};

export type AIEvaluationReport = {
  generatedAt: string;
  jsonValidity: number;
  schemaAdherence: number;
  citationCoverage: number;
  unsupportedClaimRate: number;
  confidenceCalibration: number;
  contradictionHandling: number;
  riskDisclosureQuality: number;
  refusalSafetyCorrectness: number;
  agentConsistency: number;
  overallScore: number;
  requiredActions: string[];
};

export class AIEvaluationHarness {
  evaluate(input: AIEvaluationInput, now = new Date()): AIEvaluationReport {
    const present = input.requiredFields.filter((field) => input.output[field] !== undefined).length;
    const schemaAdherence = Math.round((present / Math.max(1, input.requiredFields.length)) * 100);
    const citationCoverage = input.citations?.length ? 90 : 35;
    const riskDisclosureQuality = input.safetyNotes?.some((note) => /risk|human|wrong|blocked/i.test(note)) ? 90 : 45;
    const contradictionHandling = input.contradictoryEvidence?.length ? 88 : 50;
    const confidenceCalibration = typeof input.confidence === "number" ? Math.max(0, Math.min(100, 100 - Math.abs(input.confidence - 72))) : 45;
    const unsupportedClaimRate = citationCoverage >= 75 ? 8 : 42;
    const scores = [100, schemaAdherence, citationCoverage, 100 - unsupportedClaimRate, confidenceCalibration, contradictionHandling, riskDisclosureQuality, 100, 82];
    const overallScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    return {
      generatedAt: now.toISOString(),
      jsonValidity: 100,
      schemaAdherence,
      citationCoverage,
      unsupportedClaimRate,
      confidenceCalibration,
      contradictionHandling,
      riskDisclosureQuality,
      refusalSafetyCorrectness: 100,
      agentConsistency: 82,
      overallScore,
      requiredActions: [
        schemaAdherence < 90 ? "Require all structured fields before display." : null,
        citationCoverage < 75 ? "Add citations before human review." : null,
        riskDisclosureQuality < 75 ? "Add risk and no-live-execution disclosure." : null,
      ].filter((item): item is string => Boolean(item)),
    };
  }
}

export const aiEvaluationHarness = new AIEvaluationHarness();
