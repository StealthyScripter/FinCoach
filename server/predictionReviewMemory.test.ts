import assert from "node:assert/strict";
import { agentMemoryService } from "./memoryService.ts";
import { predictionReviewService } from "./predictionReviewService.ts";
import { storage } from "./storage.ts";

agentMemoryService.clearForTest();
predictionReviewService.clearForTest();

const record = predictionReviewService.record({
  originalThesis: "Boeing short thesis built on a stale headline",
  confidence: 91,
  evidenceUsed: ["headline", "momentum"],
  missingEvidence: ["No confirmation of deterioration in fundamentals"],
  expectedOutcome: "The stock should drop further.",
  actualOutcome: null,
  timeHorizon: "1 week",
  agent: "verification",
  strategyDowngraded: false,
});

const review = predictionReviewService.review({
  predictionId: record.id,
  actualOutcome: "Wrong call; the move reversed and the thesis failed.",
  missingEvidence: ["Ignored the absence of confirmation and catalyst follow-through"],
  agent: "verification",
});

const secondRecord = predictionReviewService.record({
  originalThesis: "Another stale thesis",
  confidence: 88,
  evidenceUsed: ["headline"],
  missingEvidence: ["Catalyst strength was not checked"],
  expectedOutcome: "Further downside.",
  actualOutcome: null,
  timeHorizon: "2 weeks",
  agent: "verification",
  strategyDowngraded: false,
});

predictionReviewService.review({
  predictionId: secondRecord.id,
  actualOutcome: "Wrong again; the thesis failed for the same reason.",
  missingEvidence: ["No confirmation and no catalyst follow-through"],
  agent: "verification",
});

assert.ok(agentMemoryService.longTerm.findByTag("prediction_review").length > 0);
assert.ok(agentMemoryService.semantic.searchSimilar("Do not upgrade a thesis").length > 0);
const recall = agentMemoryService.recall("Do not upgrade a thesis", 5);
assert.ok(recall.some((item) => item.metadata.predictionId === record.id));
assert.ok(recall.some((item) => item.source === "long_term" || item.source === "semantic"));
assert.ok(recall.some((item) => item.artifactLinks.some((link) => link.href.includes("/journal?predictionId="))));
assert.ok(recall.some((item) => typeof item.metadata.graphNodeId === "string"));
assert.ok(recall.some((item) => item.artifactLinks.some((link) => link.href.includes("/intelligence?start=prediction-review-"))));

const overview = await storage.getMarketPilotOverview();
const { tradingAssistantService } = await import("./tradingAssistantService.ts");
const assistant = await tradingAssistantService.respond({ prompt: "Boeing short thesis review" }, overview);

assert.ok(assistant.historicalAnalogues.some((analogue) => analogue.lesson.includes("Check whether the prior decision changed")));
assert.ok(assistant.historicalAnalogues.some((analogue) => analogue.summary.includes(review.updatedLesson)));

console.log("prediction review memory tests passed");
