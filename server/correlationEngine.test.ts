import assert from "node:assert/strict";
import { crossAssetRelationshipReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.correlation.analyze(createSeedOverview().portfolio);
crossAssetRelationshipReportSchema.parse(report);
assert.ok(report.relationships.some((item) => item.relationship === "inverse" || item.relationship === "positive"));
console.log("correlationEngine smoke tests passed");
