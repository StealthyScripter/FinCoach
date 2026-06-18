import assert from "node:assert/strict";
import { createSeedOverview } from "./storage";
import { aiResearchDraftService } from "./aiResearchDraftService";

const result = await aiResearchDraftService.generate(createSeedOverview(), "SPY", new Date("2026-01-15T14:00:00.000Z"));

assert.equal(result.report.asset, "SPY");
assert.equal(result.report.agent, "verification");
assert.ok(result.report.verification.sources.length > 0);
assert.ok(result.ragContext.chunks.length > 0);
assert.ok(result.aiEvaluation.overallScore > 0);
assert.equal(typeof result.displayApproved, "boolean");

console.log("aiResearchDraftService smoke tests passed");
