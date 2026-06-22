import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { createSeedOverview } from "./storage";
import { modelValidationBenchmarkService } from "./modelValidationBenchmarkService";

eventLogService.clearForTest();
const overview = createSeedOverview();
const report = modelValidationBenchmarkService.run(overview, new Date("2026-01-15T14:00:00.000Z"));

assert.equal(report.benchmarkVersion, "marketpilot-model-validation-v1");
assert.equal(report.models.length, 4);
assert.ok(report.overallScore >= 0);
assert.ok(["pass", "review", "fail"].includes(report.status));
assert.ok(report.bestModelId.length > 0);
assert.ok(report.requiredActions.length >= 0);
assert.ok(report.evidence.length > 0);

const event = modelValidationBenchmarkService.record(report, overview);
assert.equal(event.type, "analytics.model_validation_recorded");
assert.equal(event.sourceService, "model-validation-benchmark-service");
assert.equal(event.payload.overallScore, report.overallScore);
assert.equal(modelValidationBenchmarkService.latest().length, 1);
assert.equal(eventLogService.countByType("analytics.model_validation_recorded"), 1);

console.log("modelValidationBenchmarkService smoke tests passed");
