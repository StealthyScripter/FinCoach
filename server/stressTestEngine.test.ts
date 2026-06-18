import assert from "node:assert/strict";
import { stressTestReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.stress.run(createSeedOverview().portfolio);
stressTestReportSchema.parse(report);
assert.ok(report.scenarios.length >= 7);
assert.ok(report.worstScenario.length > 0);
console.log("stressTestEngine smoke tests passed");
