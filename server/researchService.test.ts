import assert from "node:assert/strict";
import { researchReportSchema } from "@shared/schema";
import { ResearchService } from "./researchService";

const service = new ResearchService();

const explanation = await service.explainMove("SPY");
assert.equal(explanation.symbol, "SPY");
assert.ok(explanation.confidence >= 70);
assert.ok(explanation.evidence.length >= 4);
assert.ok(explanation.relatedAssets.includes("SPY"));
assert.match(explanation.mainCause, /yields|macro/i);
assert.equal(explanation.verification.sources.length >= 3, true);

const briefing = await service.generateMarketBriefing("QQQ");
assert.doesNotThrow(() => researchReportSchema.parse(briefing));
assert.equal(briefing.asset, "QQQ");
assert.equal(briefing.classification, "interpretation");
assert.ok(briefing.verification.whatWouldDisprove.length > 20);

console.log("researchService smoke tests passed");
