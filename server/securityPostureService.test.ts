import assert from "node:assert/strict";
import { securityPostureReportSchema } from "@shared/schema";
import { brokerReadinessService } from "./brokerReadinessService";
import { liveAssistancePolicyService } from "./liveAssistancePolicyService";
import { securityPostureService } from "./securityPostureService";
import { createSeedOverview } from "./storage";

const overview = createSeedOverview();
const brokerReadiness = brokerReadinessService.evaluate(overview, { now: new Date("2026-01-15T14:00:00.000Z") });
const livePolicy = liveAssistancePolicyService.evaluate({
  overview,
  brokerReadiness,
  now: new Date("2026-01-15T14:00:00.000Z"),
});
const report = securityPostureService.evaluate({
  overview,
  brokerReadiness,
  livePolicy,
  rateLimiterEnabled: true,
  now: new Date("2026-01-15T14:00:00.000Z"),
});

securityPostureReportSchema.parse(report);

assert.equal(report.id, "security-posture-current");
assert.equal(report.liveExecutionBlocked, true);
assert.ok(report.controls.some((control) => control.id === "credential_vault" && control.status === "fail"));
assert.ok(report.controls.some((control) => control.id === "rate_limits" && control.status === "warning"));
assert.ok(report.controls.some((control) => control.id === "environment_separation" && control.status === "pass"));
assert.ok(report.requiredActions.some((action) => /vault/.test(action)));
assert.ok(report.requiredActions.some((action) => /Redis/.test(action)));

console.log("securityPostureService smoke tests passed");
