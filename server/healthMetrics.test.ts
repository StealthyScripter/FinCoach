import assert from "node:assert/strict";
import { metricsSnapshotSchema, storageHealthSchema } from "@shared/schema";
import { eventLogService } from "./eventLogService";
import { metricsService } from "./metricsService";
import { createSeedOverview } from "./storage";
import { getStorageHealth, validateDatabaseUrl } from "./storageMode";
import { verificationQualityService } from "./verificationQualityService";

assert.equal(validateDatabaseUrl("postgres://user:pass@localhost:5432/marketpilot").valid, true);
assert.equal(validateDatabaseUrl("mysql://user:pass@localhost/db").valid, false);

const storageHealth = getStorageHealth(new Date("2026-01-15T14:00:00.000Z"));
storageHealthSchema.parse(storageHealth);
assert.ok(["memory", "postgres"].includes(storageHealth.mode));
assert.ok(storageHealth.checks.some((check) => check.id === "migration_version"));

eventLogService.clearForTest();
eventLogService.append({
  type: "supervisor.workflow_completed",
  userId: "user-demo",
  sourceService: "agent-service",
  payload: { ticketReviews: 2 },
});

const overview = createSeedOverview();
const verificationQuality = verificationQualityService.evaluate(overview, new Date("2026-01-15T14:00:00.000Z"));
const metrics = metricsService.snapshot({
  overview,
  verificationQuality,
  now: new Date("2026-01-15T14:00:00.000Z"),
});

metricsSnapshotSchema.parse(metrics);
assert.equal(metrics.supervisorWorkflowCount, 1);
assert.ok(metrics.averageVerificationScore > 0);
assert.ok(metrics.eventLogCount >= 1);

console.log("healthMetrics smoke tests passed");
