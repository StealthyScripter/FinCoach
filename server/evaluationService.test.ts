import assert from "node:assert/strict";
import { evaluationReportSchema } from "@shared/schema";
import { agentOrchestrationService } from "./agentOrchestrationService";
import { evaluationService } from "./evaluationService";
import { portfolioRiskAnalyticsService } from "./portfolioRiskAnalyticsService";
import { createSeedOverview } from "./storage";

const overview = createSeedOverview();
const agents = agentOrchestrationService.generateOutputs(overview, new Date("2026-01-15T14:00:00.000Z"));
const portfolioRisk = portfolioRiskAnalyticsService.analyze(overview.portfolio, new Date("2026-01-15T14:00:00.000Z"));
const report = evaluationService.evaluate({
  overview,
  agents,
  portfolioRisk,
  now: new Date("2026-01-15T14:00:00.000Z"),
});

evaluationReportSchema.parse(report);

assert.equal(report.benchmarkVersion, "marketpilot-eval-v1");
assert.equal(report.security.executionBlocked, true);
assert.equal(report.security.piiIncluded, false);
assert.ok(report.overallScore >= 0 && report.overallScore <= 100);
assert.equal(report.suites.length, 4);
assert.ok(report.suites.some((suite) => suite.id === "research_verification"));
assert.ok(report.suites.some((suite) => suite.id === "risk_performance"));
assert.ok(report.suites.some((suite) => suite.id === "behavioral_learning"));
assert.ok(report.suites.some((suite) => suite.id === "agent_reliability"));
assert.ok(report.monitoring.recommendedMetrics.includes("evaluation_overall_score"));
assert.ok(report.requiredActions.every((action) => action.length > 0));

console.log("evaluationService smoke tests passed");
