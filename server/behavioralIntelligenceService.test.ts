import assert from "node:assert/strict";
import { behavioralIntelligenceReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.behavior.evaluate(createSeedOverview());
behavioralIntelligenceReportSchema.parse(report);
assert.ok(report.behavioralScore >= 0);
assert.ok(report.learningSuggestions.length > 0);
console.log("behavioralIntelligenceService smoke tests passed");
