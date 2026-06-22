import assert from "node:assert/strict";
import { createSeedOverview } from "./storage";
import { aiResearchDraftService } from "./aiResearchDraftService";
import { eventLogService } from "./eventLogService";
import { storage } from "./storage";

const result = await aiResearchDraftService.generate(createSeedOverview(), "SPY", new Date("2026-01-15T14:00:00.000Z"));

assert.equal(result.report.asset, "SPY");
assert.equal(result.report.agent, "verification");
assert.ok(result.report.verification.sources.length > 0);
assert.ok(result.ragContext.chunks.length > 0);
assert.ok(result.aiEvaluation.overallScore > 0);
assert.equal(typeof result.displayApproved, "boolean");
assert.ok(result.aiArtifact.requestId.length > 0);
assert.equal(result.aiArtifact.attempts, 1);
assert.equal(result.aiArtifact.safety.liveTradingBlocked, true);

eventLogService.clearForTest();
const overview = await storage.getMarketPilotOverview();
await aiResearchDraftService.persistDraft(result, overview.user.id);
const persistedOverview = await storage.getMarketPilotOverview();
assert.ok(persistedOverview.researchReports.some((report) => report.id === result.report.id));
assert.ok(persistedOverview.auditLogs.some((event) => event.action === "generated_research_report" && event.target === result.report.id));
assert.ok(eventLogService.snapshot().events.some((event) => event.type === "research.report_generated" && event.correlationId === result.report.id));
assert.ok((await storage.getAiEvaluations()).some((evaluation) => evaluation.artifactId === result.report.id));
const generatedEvent = eventLogService.snapshot().events.find((event) => event.type === "research.report_generated" && event.correlationId === result.report.id);
assert.ok(generatedEvent);
assert.equal(typeof generatedEvent?.payload.aiModel, "string");
assert.ok(typeof generatedEvent?.payload.aiRequestId === "string");
assert.equal(generatedEvent?.payload.aiAttempts, 1);
assert.equal(generatedEvent?.payload.aiTokenUsage.totalTokens > 0, true);

console.log("aiResearchDraftService smoke tests passed");
