import assert from "node:assert/strict";
import { regimeReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.regime.classify(createSeedOverview());
regimeReportSchema.parse(report);
assert.ok(report.confidence > 0);
assert.ok(report.supportingEvidence.length > 0);
console.log("regimeDetectionService smoke tests passed");
