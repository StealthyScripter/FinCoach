import assert from "node:assert/strict";
import { factorExposureReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.factors.analyze(createSeedOverview().portfolio);
factorExposureReportSchema.parse(report);
assert.ok(report.exposures.marketBeta >= 0);
assert.ok(report.riskContributions.length > 0);
console.log("factorExposureService smoke tests passed");
