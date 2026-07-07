import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { otelTraceService } from "./otelTraceService";

eventLogService.clearForTest();
executionAuditLog.clearForTest();
const correlationId = `trace-otel-${Date.now()}`;
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
await eventLogService.flushPersistence();
await executionAuditLog.flushPersistence();

const exportReport = await otelTraceService.build(correlationId);

assert.equal(exportReport.correlationId, correlationId);
assert.equal(exportReport.spanCount, 2);
assert.equal(exportReport.traceId.length, 32);
assert.ok(exportReport.spans.every((span) => span.traceId === exportReport.traceId));
assert.ok(exportReport.spans.every((span) => span.status === "ok"));
assert.equal(exportReport.spans[0].parentSpanId, null);
assert.ok(exportReport.spans[1].parentSpanId);

console.log("otelTraceService smoke tests passed");
