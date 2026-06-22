import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { traceService } from "./traceService";

eventLogService.clearForTest();
executionAuditLog.clearForTest();

eventLogService.append({
  type: "risk.check_completed",
  userId: "trace-user",
  sourceService: "risk-service",
  correlationId: "trace-1",
  payload: { approved: true },
  createdAt: "2026-01-15T14:00:00.000Z",
});
executionAuditLog.append({
  action: "risk.check",
  outcome: "accepted",
  correlationId: "trace-1",
  detail: { approved: true },
});

const report = await traceService.build("trace-1");

assert.equal(report.correlationId, "trace-1");
assert.equal(report.eventCount, 1);
assert.equal(report.auditCount, 1);
assert.equal(report.entryCount, 2);
assert.ok(report.entries.some((entry) => entry.source === "event_log"));
assert.ok(report.entries.some((entry) => entry.source === "execution_audit"));
assert.equal(report.firstSeenAt, "2026-01-15T14:00:00.000Z");

console.log("traceService smoke tests passed");
