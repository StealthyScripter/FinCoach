import assert from "node:assert/strict";
import { verificationQualityReportSchema } from "@shared/schema";
import { createSeedOverview } from "./storage";
import { verificationQualityService } from "./verificationQualityService";

const report = verificationQualityService.evaluate(
  createSeedOverview(),
  new Date("2026-01-15T14:00:00.000Z"),
);

verificationQualityReportSchema.parse(report);

assert.equal(report.id, "verification-quality-current");
assert.ok(report.sampledClaims > 0);
assert.ok(report.sourceCoverage.totalSources > 0);
assert.ok(report.score >= 0 && report.score <= 100);
assert.ok(report.freshnessScore >= 0 && report.freshnessScore <= 100);
assert.ok(report.evidenceWeightScore >= 0 && report.evidenceWeightScore <= 100);
assert.ok(report.hallucinationRiskScore >= 0 && report.hallucinationRiskScore <= 100);
assert.ok(report.evidence.some((item) => /verification check/.test(item)));

console.log("verificationQualityService smoke tests passed");
