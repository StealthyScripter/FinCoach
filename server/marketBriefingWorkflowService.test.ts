import assert from "node:assert/strict";
import { scheduledMarketBriefingSchema } from "@shared/schema";
import { MarketBriefingWorkflowService } from "./marketBriefingWorkflowService";

const service = new MarketBriefingWorkflowService();
const briefing = await service.run(["SPY", "QQQ", "SPY"], new Date("2026-06-15T12:00:00.000Z"));

scheduledMarketBriefingSchema.parse(briefing);
assert.deepEqual(briefing.symbols, ["SPY", "QQQ"]);
assert.equal(briefing.reports.length, 2);
assert.ok(briefing.reports.every((report) => report.verification.sources.length > 0));
assert.equal(
  briefing.verificationSummary.verified + briefing.verificationSummary.partiallyVerified + briefing.verificationSummary.requiresReview,
  briefing.reports.length,
);
assert.ok(briefing.requiredActions.length > 0);

console.log("marketBriefingWorkflowService smoke tests passed");
