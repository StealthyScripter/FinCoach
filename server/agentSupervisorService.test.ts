import assert from "node:assert/strict";
import { supervisorReportSchema } from "@shared/schema";
import { agentSupervisorService } from "./agentSupervisorService";
import { createSeedOverview } from "./storage";

const report = agentSupervisorService.review(
  createSeedOverview(),
  new Date("2026-01-15T14:00:00.000Z"),
);

supervisorReportSchema.parse(report);

assert.equal(report.id, "agent-supervisor-current");
assert.equal(report.mode, "live_blocked");
assert.ok(report.blockedCapabilities.includes("Autonomous trade placement"));
assert.ok(report.ticketReviews.length > 0);
for (const review of report.ticketReviews) {
  assert.equal(review.canPlaceLiveOrder, false);
  assert.equal(review.riskOfficerVeto, true);
  assert.equal(review.humanApprovalRequired, true);
  assert.ok(review.steps.some((step) => step.id === "execution" && step.status === "blocked"));
}

console.log("agentSupervisorService smoke tests passed");
