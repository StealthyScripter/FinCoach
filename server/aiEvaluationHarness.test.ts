import assert from "node:assert/strict";
import { aiEvaluationHarness } from "./aiEvaluationHarness";

const report = aiEvaluationHarness.evaluate({
  output: {
    thesis: "Rates pressure equities.",
    citations: [{ name: "demo" }],
    confidence: 70,
    riskFactors: ["AI can be wrong"],
    contradictoryEvidence: ["Dollar is weaker."],
  },
  requiredFields: ["thesis", "citations", "confidence", "riskFactors"],
  citations: [{ name: "demo" }],
  confidence: 70,
  safetyNotes: ["Human review required; live trading blocked."],
  contradictoryEvidence: ["Dollar is weaker."],
}, new Date("2026-01-15T14:00:00.000Z"));

assert.ok(report.overallScore > 0);
assert.equal(report.jsonValidity, 100);
assert.equal(report.schemaAdherence, 100);
assert.ok(report.riskDisclosureQuality > 0);

console.log("aiEvaluationHarness smoke tests passed");
