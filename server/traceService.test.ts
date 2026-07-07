import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { traceService } from "./traceService";

eventLogService.clearForTest();
executionAuditLog.clearForTest();
const correlationId = `trace-1-${Date.now()}`;
const eventCreatedAt = new Date(Date.now() - 1_000).toISOString();

eventLogService.append({
  type: "risk.check_completed",
  userId: "trace-user",
  sourceService: "risk-service",
  correlationId,
  payload: { approved: true },
  createdAt: eventCreatedAt,
});
executionAuditLog.append({
  action: "risk.check",
  outcome: "accepted",
  correlationId,
  detail: { approved: true },
});

const report = await traceService.build(correlationId);

assert.equal(report.correlationId, correlationId);
assert.equal(report.eventCount, 1);
assert.equal(report.auditCount, 1);
assert.equal(report.entryCount, 2);
assert.ok(report.entries.some((entry) => entry.source === "event_log"));
assert.ok(report.entries.some((entry) => entry.source === "execution_audit"));
assert.equal(report.firstSeenAt, eventCreatedAt);

console.log("traceService smoke tests passed");
