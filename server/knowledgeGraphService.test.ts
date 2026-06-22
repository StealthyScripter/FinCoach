import assert from "node:assert/strict";
import { knowledgeGraphReportSchema } from "@shared/schema";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { predictionReviewService } from "./predictionReviewService";
import { createSeedOverview } from "./storage";

predictionReviewService.clearForTest();
const record = predictionReviewService.record({
  originalThesis: "Graph traversal should expose post-mortem lessons",
  confidence: 76,
  evidenceUsed: ["review"],
  missingEvidence: ["No review node existed"],
  expectedOutcome: "A reviewable lesson should appear in the graph.",
  actualOutcome: null,
  timeHorizon: "1 day",
  agent: "verification",
  strategyDowngraded: false,
});
predictionReviewService.review({
  predictionId: record.id,
  actualOutcome: "Wrong; the earlier thesis failed and the lesson was recorded.",
  missingEvidence: ["The review should create a graph node"],
  agent: "verification",
});

const report = knowledgeGraphService.build(createSeedOverview(), `prediction-review-${record.id}`, new Date("2026-01-15T14:00:00.000Z"));
const defaultReport = knowledgeGraphService.build(createSeedOverview());

knowledgeGraphReportSchema.parse(report);
assert.ok(report.nodes.length > 0);
assert.ok(report.edges.length > 0);
assert.ok(report.nodes.some((node) => node.type === "Asset"));
assert.ok(report.nodes.some((node) => node.id === `prediction-review-${record.id}`));
assert.ok(report.nodes.some((node) => node.id === `prediction-lesson-${record.id}` && node.type === "LessonLearned"));
assert.ok(defaultReport.traversal.visitedNodeIds.length > 0);
assert.ok(defaultReport.traversal.pathSummaries.length > 0);

console.log("knowledgeGraphService smoke tests passed");
